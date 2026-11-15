import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import {
  bookings, folioItems, posDayCloses, posDevices, posItems, posOrderLines, posOrders, posPayments, posReceipts, posTables,
  type Hotel, type PosDevice, type PosItem, type PosOrder, type PosOrderLine, type PosReceipt, type PosTable, type PosReceiptItem,
} from "../db/schema";
import { todayIn } from "../domain/dates";
import {
  GENESIS_HASH, METHODS, bonGaps, businessDay, checkSelection, dayReport, hashReceipt, openTotalRappen, outstanding, receiptNumber, selectionTotal,
  verifyChain, type DayReport, type Line, type Method, type Selection,
} from "../domain/pos";
import { audit } from "./audit";
import { invoicingSettings } from "./invoicing";

/**
 * Restaurant und Kasse (SPEC 19.16). Bestellzeilen, Bons, Zahlungen und Tagesabschlüsse werden nur angehängt (Datenbank-Trigger sperren
 * Änderungen); Korrekturen sind Stornozeilen und Gegenbons. Jede Abfrage nach hotel_id.
 */
export class PosError extends Error {}

const clean = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);

// ---------------------------------------------------------------- Artikel, Tische, Geräte

export type ItemInput = { category?: string; name: string; priceRappen: number; vatDineInBps: number; vatTakeawayBps: number; dailySpecial?: boolean; active?: boolean; sortOrder?: number };

export const listItems = (hotelId: string, onlyActive = false) =>
  db().select().from(posItems).where(onlyActive ? and(eq(posItems.hotelId, hotelId), eq(posItems.active, true)) : eq(posItems.hotelId, hotelId)).orderBy(asc(posItems.category), asc(posItems.sortOrder), asc(posItems.name));

export async function saveItem(hotelId: string, id: string | null, i: ItemInput, actor: string): Promise<PosItem> {
  const name = clean(i.name, 120);
  if (!name) throw new PosError("Der Name fehlt.");
  if (!Number.isInteger(i.priceRappen) || i.priceRappen < 0 || i.priceRappen > 10_000_000) throw new PosError("Preis ungültig.");
  for (const b of [i.vatDineInBps, i.vatTakeawayBps]) if (!Number.isInteger(b) || b < 0 || b > 2500) throw new PosError("MWST-Satz ungültig (0 bis 25 %).");
  const v = { category: clean(i.category, 60), name, priceRappen: i.priceRappen, vatDineInBps: i.vatDineInBps, vatTakeawayBps: i.vatTakeawayBps, dailySpecial: i.dailySpecial ?? false, active: i.active ?? true, sortOrder: i.sortOrder ?? 0 };
  return db().transaction(async (tx) => {
    let it: PosItem;
    if (id) {
      [it] = await tx.update(posItems).set(v).where(and(eq(posItems.id, id), eq(posItems.hotelId, hotelId))).returning();
      if (!it) throw new PosError("Artikel nicht gefunden.");
    } else [it] = await tx.insert(posItems).values({ ...v, hotelId }).returning();
    await audit(tx, { hotelId, actor, action: id ? "pos.item_update" : "pos.item_create", entity: "pos_item", entityId: it.id });
    return it;
  });
}

export const listTables = (hotelId: string) => db().select().from(posTables).where(and(eq(posTables.hotelId, hotelId), eq(posTables.active, true))).orderBy(asc(posTables.sortOrder), asc(posTables.name));

export async function saveTable(hotelId: string, name: string, actor: string): Promise<PosTable> {
  const n = clean(name, 30);
  if (!n) throw new PosError("Der Name fehlt.");
  const [t] = await db().insert(posTables).values({ hotelId, name: n, sortOrder: (await listTables(hotelId)).length }).onConflictDoNothing().returning();
  if (!t) throw new PosError("Diesen Tisch gibt es schon.");
  await audit(db(), { hotelId, actor, action: "pos.table_create", entity: "pos_table", entityId: t.id });
  return t;
}

export const listDevices = (hotelId: string) => db().select().from(posDevices).where(eq(posDevices.hotelId, hotelId)).orderBy(asc(posDevices.code));

/** Gerät (eigener Bon-Nummernkreis). Code 1 bis 6 Zeichen A–Z, 0–9. */
export async function createDevice(hotelId: string, code: string, label: string, actor: string): Promise<PosDevice> {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,6}$/.test(c)) throw new PosError("Gerätecode: 1 bis 6 Zeichen (A–Z, 0–9).");
  const [d] = await db().insert(posDevices).values({ hotelId, code: c, label: clean(label, 60) }).onConflictDoNothing().returning();
  if (!d) throw new PosError("Diesen Gerätecode gibt es schon.");
  await audit(db(), { hotelId, actor, action: "pos.device_create", entity: "pos_device", entityId: d.id, details: { code: c } });
  return d;
}

// ---------------------------------------------------------------- Bestellung

/** Bestellung eröffnen. Die Id kommt vom Gerät (auch offline); dieselbe Id liefert dieselbe Bestellung (idempotent). */
export async function openOrder(hotelId: string, i: { id?: string; tableId?: string | null; deviceId?: string | null; label?: string; deviceAt?: Date | null }, actor: string): Promise<PosOrder> {
  const id = i.id ?? crypto.randomUUID();
  if (i.tableId) {
    const [t] = await db().select({ id: posTables.id }).from(posTables).where(and(eq(posTables.id, i.tableId), eq(posTables.hotelId, hotelId)));
    if (!t) throw new PosError("Tisch nicht gefunden.");
  }
  if (i.deviceId) {
    const [d] = await db().select({ id: posDevices.id }).from(posDevices).where(and(eq(posDevices.id, i.deviceId), eq(posDevices.hotelId, hotelId)));
    if (!d) throw new PosError("Gerät nicht gefunden.");
  }
  const [o] = await db().insert(posOrders).values({ id, hotelId, tableId: i.tableId ?? null, deviceId: i.deviceId ?? null, label: clean(i.label, 60), openedBy: actor, deviceAt: i.deviceAt ?? null }).onConflictDoNothing().returning();
  if (o) return o;
  const [ex] = await db().select().from(posOrders).where(and(eq(posOrders.id, id), eq(posOrders.hotelId, hotelId)));
  if (!ex) throw new PosError("Diese Bestellnummer gehört zu einem anderen Betrieb.");
  return ex;
}

export type LineInput = { id?: string; itemId: string; quantity: number; mode?: "dine_in" | "takeaway"; deviceAt?: Date | null };

/** Zeilen anhängen (Bestellen und Nachbestellen). Preis und MWST-Satz werden aus dem Artikel übernommen und festgehalten; nicht MWST-pflichtige Betriebe haben Satz 0. */
export async function addLines(hotel: Hotel, orderId: string, inputs: LineInput[], actor: string): Promise<PosOrderLine[]> {
  if (!inputs.length) throw new PosError("Nichts bestellt.");
  const vatLiable = invoicingSettings(hotel).vatLiable;
  return db().transaction(async (tx) => {
    const lockedOrder = rows<{ id: string }>(await tx.execute(sql`SELECT id FROM pos_orders WHERE id = ${orderId} AND hotel_id = ${hotel.id} FOR UPDATE`));
    if (!lockedOrder.length) throw new PosError("Bestellung nicht gefunden.");
    const out: PosOrderLine[] = [];
    for (const i of inputs) {
      if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 99) throw new PosError("Menge: 1 bis 99.");
      const [it] = await tx.select().from(posItems).where(and(eq(posItems.id, i.itemId), eq(posItems.hotelId, hotel.id)));
      if (!it || !it.active) throw new PosError("Artikel nicht verfügbar.");
      const mode = i.mode ?? "dine_in";
      const bps = vatLiable ? (mode === "takeaway" ? it.vatTakeawayBps : it.vatDineInBps) : 0;
      const id = i.id ?? crypto.randomUUID();
      const ins = await tx.insert(posOrderLines).values({ id, hotelId: hotel.id, orderId, itemId: it.id, description: it.name, quantity: i.quantity, unitPriceRappen: it.priceRappen, vatBps: bps, mode, createdBy: actor, deviceAt: i.deviceAt ?? null }).onConflictDoNothing().returning();
      if (ins.length) out.push(ins[0]);
      else {
        const [ex] = await tx.select().from(posOrderLines).where(and(eq(posOrderLines.id, id), eq(posOrderLines.hotelId, hotel.id), eq(posOrderLines.orderId, orderId)));
        if (!ex) throw new PosError("Diese Zeilen-Id gehört zu einer anderen Bestellung.");
        out.push(ex); // Wiederholung vom Gerät
      }
    }
    return out;
  });
}

/** Rabatt als eigene Zeile mit negativem Betrag (Grund Pflicht). Die Rolle prüft die Seite (Manager). */
export async function addDiscount(hotel: Hotel, orderId: string, i: { description: string; amountRappen: number; vatBps: number; reason: string; id?: string }, actor: string): Promise<PosOrderLine> {
  const reason = clean(i.reason, 200);
  if (!reason) throw new PosError("Bitte einen Grund für den Rabatt angeben.");
  if (!Number.isInteger(i.amountRappen) || i.amountRappen <= 0 || i.amountRappen > 10_000_000) throw new PosError("Rabattbetrag ungültig.");
  const bps = invoicingSettings(hotel).vatLiable ? i.vatBps : 0;
  const [o] = await db().select({ id: posOrders.id }).from(posOrders).where(and(eq(posOrders.id, orderId), eq(posOrders.hotelId, hotel.id)));
  if (!o) throw new PosError("Bestellung nicht gefunden.");
  const [l] = await db().insert(posOrderLines).values({ id: i.id ?? crypto.randomUUID(), hotelId: hotel.id, orderId, description: clean(i.description, 120) || "Rabatt", quantity: 1, unitPriceRappen: -i.amountRappen, vatBps: bps, reason, createdBy: actor }).returning();
  await audit(db(), { hotelId: hotel.id, actor, action: "pos.discount", entity: "pos_order", entityId: orderId, details: { amountRappen: i.amountRappen, reason } });
  return l;
}

/** Storno einer noch nicht bezahlten Zeile (ganz oder teilweise) als Stornozeile, mit Grund. Bezahltes geht nur über einen Gegenbon. */
export async function reverseLine(hotelId: string, lineId: string, quantity: number, reason: string, actor: string): Promise<PosOrderLine> {
  const why = clean(reason, 200);
  if (!why) throw new PosError("Bitte einen Grund für das Storno angeben.");
  return db().transaction(async (tx) => {
    const [l] = await tx.select().from(posOrderLines).where(and(eq(posOrderLines.id, lineId), eq(posOrderLines.hotelId, hotelId)));
    if (!l || l.reversesLineId) throw new PosError("Zeile nicht gefunden.");
    const locked = rows<{ id: string }>(await tx.execute(sql`SELECT id FROM pos_orders WHERE id = ${l.orderId} AND hotel_id = ${hotelId} FOR UPDATE`));
    if (!locked.length) throw new PosError("Bestellung nicht gefunden.");
    const { lines, paid } = await orderState(tx, hotelId, l.orderId);
    const open = outstanding(lines, paid).get(l.id) ?? 0;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > open) throw new PosError(open <= 0 ? "Diese Zeile ist schon bezahlt. Korrektur nur mit Gegenbon." : `Es sind nur noch ${open} offen.`);
    const [r] = await tx.insert(posOrderLines).values({ id: crypto.randomUUID(), hotelId, orderId: l.orderId, itemId: l.itemId, description: l.description, quantity: -quantity, unitPriceRappen: l.unitPriceRappen, vatBps: l.vatBps, mode: l.mode, reversesLineId: l.id, reason: why, createdBy: actor }).returning();
    await audit(tx, { hotelId, actor, action: "pos.line_reverse", entity: "pos_order", entityId: l.orderId, details: { lineId, quantity, reason: why } });
    return r;
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
type Ex = Tx | ReturnType<typeof db>;

async function orderState(ex: Ex, hotelId: string, orderId: string) {
  const ls = await ex.select().from(posOrderLines).where(and(eq(posOrderLines.orderId, orderId), eq(posOrderLines.hotelId, hotelId))).orderBy(asc(posOrderLines.createdAt));
  const rs = await ex.select({ items: posReceipts.items }).from(posReceipts).where(and(eq(posReceipts.orderId, orderId), eq(posReceipts.hotelId, hotelId)));
  const lines: Line[] = ls.map((l) => ({ id: l.id, quantity: l.quantity, unitPriceRappen: l.unitPriceRappen, vatBps: l.vatBps, reversesLineId: l.reversesLineId }));
  const paid = rs.flatMap((r) => r.items.map((i) => ({ lineId: i.lineId, quantity: i.quantity })));
  return { rows: ls, lines, paid };
}

export async function orderView(hotelId: string, orderId: string) {
  const [order] = await db().select().from(posOrders).where(and(eq(posOrders.id, orderId), eq(posOrders.hotelId, hotelId)));
  if (!order) return null;
  const st = await orderState(db(), hotelId, orderId);
  const open = outstanding(st.lines, st.paid);
  const receipts = await db().select().from(posReceipts).where(and(eq(posReceipts.orderId, orderId), eq(posReceipts.hotelId, hotelId))).orderBy(asc(posReceipts.seq));
  return {
    order, receipts, openTotalRappen: openTotalRappen(st.lines, st.paid),
    lines: st.rows.filter((l) => !l.reversesLineId).map((l) => ({ line: l, openQuantity: open.get(l.id) ?? 0 })),
    reversals: st.rows.filter((l) => l.reversesLineId),
  };
}

/** Tische mit offener Bestellung und offenem Betrag */
export async function tablesOverview(hotelId: string) {
  const ts = await listTables(hotelId);
  const os = await db().select().from(posOrders).where(eq(posOrders.hotelId, hotelId)).orderBy(desc(posOrders.openedAt)).limit(300);
  const result = [];
  for (const t of ts) {
    const orders = [];
    for (const o of os.filter((x) => x.tableId === t.id)) {
      const st = await orderState(db(), hotelId, o.id);
      const open = openTotalRappen(st.lines, st.paid);
      if (open > 0) orders.push({ order: o, openRappen: open });
    }
    result.push({ table: t, orders });
  }
  return result;
}

// ---------------------------------------------------------------- Bezahlen

export type PayInput = {
  orderId: string; deviceId: string; selection: Selection[]; payments: { method: Method; amountRappen: number }[]; tipRappen?: number;
  bookingReference?: string; /** vom Gerät vergeben (offline) */ receiptId?: string; bonNo?: number; deviceAt?: Date | null;
};

/** Verkettung der Bons eines Betriebs: nächste Nummer und Hash der vorigen (unter Sperre, damit die Kette ohne Lücke bleibt) */
async function chainHead(tx: Tx, hotelId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"posreceipt:" + hotelId}))`);
  const [last] = await tx.select({ seq: posReceipts.seq, hash: posReceipts.hash }).from(posReceipts).where(eq(posReceipts.hotelId, hotelId)).orderBy(desc(posReceipts.seq)).limit(1);
  return { seq: (last?.seq ?? 0) + 1, prevHash: last?.hash ?? GENESIS_HASH };
}

/** Geschäftstag eines Bons (Hotelzeit). Gerätezeit zählt nur, wenn sie plausibel ist (nicht in der Zukunft, höchstens 7 Tage alt). */
async function resolveDay(tx: Ex, hotel: Hotel, now: Date, deviceAt: Date | null) {
  const plausible = deviceAt && deviceAt.getTime() <= now.getTime() + 60_000 && now.getTime() - deviceAt.getTime() < 7 * 86_400_000;
  const paidDay = todayIn(hotel.timezone, plausible ? deviceAt : now);
  const today = todayIn(hotel.timezone, now);
  const closed = new Set<string>();
  const closes = await tx.select({ day: posDayCloses.day }).from(posDayCloses).where(and(eq(posDayCloses.hotelId, hotel.id), sql`${posDayCloses.day} >= ${paidDay < today ? paidDay : today}`));
  for (const c of closes) closed.add(c.day);
  return businessDay(paidDay, today, (d) => closed.has(d));
}

/** Bon-Nummer: vom Gerät (offline) oder fortlaufend vom Server. Beim Gerät zählt die höchste bekannte Nummer weiter. */
async function takeBonNo(tx: Tx, device: PosDevice, wanted: number | undefined): Promise<number> {
  if (wanted !== undefined) {
    if (!Number.isInteger(wanted) || wanted < 1) throw new PosError("Ungültige Bon-Nummer.");
    await tx.update(posDevices).set({ lastBon: sql`greatest(${posDevices.lastBon}, ${wanted})` }).where(eq(posDevices.id, device.id));
    return wanted;
  }
  const [d] = await tx.update(posDevices).set({ lastBon: sql`${posDevices.lastBon} + 1` }).where(eq(posDevices.id, device.id)).returning({ n: posDevices.lastBon });
  return d.n;
}

/**
 * Bezahlen (ein Bon für die gewählten Zeilen und Mengen: Splitten nach Gast oder Posten).
 * Zahlarten: bar, Karte, TWINT (Bestätigung durch das Personal), aufs Zimmer (Posten in der Hotelrechnung, SPEC 16.3).
 * Wiederholung mit derselben receiptId liefert den bestehenden Bon (Offline-Sync).
 */
export async function pay(hotel: Hotel, i: PayInput, actor: string): Promise<PosReceipt> {
  const hotelId = hotel.id;
  const tip = i.tipRappen ?? 0;
  if (!Number.isInteger(tip) || tip < 0 || tip > 1_000_000) throw new PosError("Trinkgeld ungültig.");
  for (const p of i.payments) if (!METHODS.includes(p.method) || !Number.isInteger(p.amountRappen) || p.amountRappen <= 0) throw new PosError("Zahlung ungültig.");
  const receiptId = i.receiptId ?? crypto.randomUUID();
  return db().transaction(async (tx) => {
    const [existing] = await tx.select().from(posReceipts).where(and(eq(posReceipts.id, receiptId), eq(posReceipts.hotelId, hotelId)));
    if (existing) return existing;
    const locked = rows<{ id: string }>(await tx.execute(sql`SELECT id FROM pos_orders WHERE id = ${i.orderId} AND hotel_id = ${hotelId} FOR UPDATE`));
    if (!locked.length) throw new PosError("Bestellung nicht gefunden.");
    const [device] = await tx.select().from(posDevices).where(and(eq(posDevices.id, i.deviceId), eq(posDevices.hotelId, hotelId)));
    if (!device) throw new PosError("Gerät nicht gefunden.");
    const st = await orderState(tx, hotelId, i.orderId);
    const bad = checkSelection(st.lines, st.paid, i.selection);
    if (bad) throw new PosError(bad);
    const t = selectionTotal(st.lines, i.selection);
    if (t.totalRappen <= 0) throw new PosError("Der Betrag muss grösser als 0 sein.");
    if (i.payments.reduce((a, p) => a + p.amountRappen, 0) !== t.totalRappen) throw new PosError("Die Zahlungen ergeben nicht den Betrag des Bons.");
    const roomPay = i.payments.find((p) => p.method === "room");
    if (roomPay && i.payments.length > 1) throw new PosError("Aufs Zimmer geht nur als einzige Zahlart.");
    let bookingId: string | null = null;
    if (roomPay) {
      const [b] = await tx.select({ id: bookings.id, status: bookings.status }).from(bookings).where(and(eq(bookings.hotelId, hotelId), eq(bookings.reference, (i.bookingReference ?? "").trim().toUpperCase())));
      if (!b || b.status !== "confirmed") throw new PosError("Buchung für «aufs Zimmer» nicht gefunden oder nicht bestätigt.");
      bookingId = b.id;
    }
    const bonNo = await takeBonNo(tx, device, i.bonNo);
    const number = receiptNumber(device.code, bonNo);
    const head = await chainHead(tx, hotelId);
    const paidAt = new Date();
    const bd = await resolveDay(tx, hotel, paidAt, i.deviceAt ?? null);
    const day = bd.day;
    const byId = new Map(st.rows.map((l) => [l.id, l]));
    const items: PosReceiptItem[] = i.selection.map((s) => { const l = byId.get(s.lineId)!; return { lineId: l.id, description: l.description, quantity: s.quantity, unitPriceRappen: l.unitPriceRappen, vatBps: l.vatBps }; });
    const rec = { hotelId, number, seq: head.seq, kind: "sale", reversesReceiptId: null, items, totalRappen: t.totalRappen, vat: t.vat, tipRappen: tip, businessDay: day, cashier: actor, paidAt: paidAt.toISOString() };
    const hash = hashReceipt(head.prevHash, rec);
    const [receipt] = await tx.insert(posReceipts).values({ id: receiptId, hotelId, orderId: i.orderId, deviceId: device.id, bonNo, number, seq: head.seq, kind: "sale", items, totalRappen: t.totalRappen, vat: t.vat, tipRappen: tip, businessDay: day, late: bd.late, cashier: actor, paidAt, deviceAt: i.deviceAt ?? null, prevHash: head.prevHash, hash }).returning();
    let folioIds: string[] = [];
    if (roomPay && bookingId) folioIds = await postToRoom(tx, hotelId, bookingId, receipt, items, tip, actor);
    for (const p of i.payments) await tx.insert(posPayments).values({ hotelId, receiptId, method: p.method, amountRappen: p.amountRappen, bookingId, folioItemIds: p.method === "room" ? folioIds : [] });
    await audit(tx, { hotelId, actor, action: "pos.pay", entity: "pos_receipt", entityId: receiptId, details: { number, totalRappen: t.totalRappen, methods: i.payments.map((p) => p.method) } });
    return receipt;
  });
}

/** Posten aufs Zimmer: je Bon-Zeile ein Posten mit dem MWST-Satz der Zeile; Trinkgeld ohne MWST. Idempotent über die externe Id. */
async function postToRoom(tx: Tx, hotelId: string, bookingId: string, receipt: PosReceipt, items: PosReceiptItem[], tip: number, actor: string): Promise<string[]> {
  const ids: string[] = [];
  for (const it of items) {
    const [f] = await tx.insert(folioItems).values({ hotelId, bookingId, description: `${it.description} (Restaurant ${receipt.number})`, quantity: it.quantity, unitPriceRappen: it.unitPriceRappen, vatKind: "standard", vatBpsOverride: it.vatBps, externalId: `pos:${receipt.id}:${it.lineId}`, source: "pos", createdBy: actor }).returning({ id: folioItems.id });
    ids.push(f.id);
  }
  if (tip) {
    const [f] = await tx.insert(folioItems).values({ hotelId, bookingId, description: `Trinkgeld (Restaurant ${receipt.number})`, quantity: receipt.kind === "reversal" ? -1 : 1, unitPriceRappen: tip, vatKind: "none", externalId: `pos:${receipt.id}:tip`, source: "pos", createdBy: actor }).returning({ id: folioItems.id });
    ids.push(f.id);
  }
  return ids;
}

/**
 * Gegenbon zu einem bezahlten Bon (Manager, Grund Pflicht): negative Mengen und Beträge, gleiche Zahlarten. Bei «aufs Zimmer» werden die
 * Posten gegengebucht; steht einer schon auf einer ausgestellten Rechnung, geht es nur per Gutschrift in den Rechnungen.
 */
export async function reverseReceipt(hotel: Hotel, receiptId: string, deviceId: string, reason: string, actor: string): Promise<PosReceipt> {
  const hotelId = hotel.id;
  const why = clean(reason, 200);
  if (!why) throw new PosError("Bitte einen Grund angeben.");
  return db().transaction(async (tx) => {
    const [orig] = await tx.select().from(posReceipts).where(and(eq(posReceipts.id, receiptId), eq(posReceipts.hotelId, hotelId)));
    if (!orig || orig.kind !== "sale") throw new PosError("Bon nicht gefunden.");
    const done = await tx.select({ id: posReceipts.id }).from(posReceipts).where(and(eq(posReceipts.hotelId, hotelId), eq(posReceipts.reversesReceiptId, orig.id)));
    if (done.length) throw new PosError("Zu diesem Bon gibt es schon einen Gegenbon.");
    const pays = await tx.select().from(posPayments).where(and(eq(posPayments.receiptId, orig.id), eq(posPayments.hotelId, hotelId)));
    const [device] = await tx.select().from(posDevices).where(and(eq(posDevices.id, deviceId), eq(posDevices.hotelId, hotelId)));
    if (!device) throw new PosError("Gerät nicht gefunden.");
    const room = pays.find((p) => p.method === "room");
    if (room?.folioItemIds.length) {
      const fs = await tx.select({ id: folioItems.id, invoiceId: folioItems.invoiceId }).from(folioItems).where(and(eq(folioItems.hotelId, hotelId), inArray(folioItems.id, room.folioItemIds)));
      if (fs.some((f) => f.invoiceId)) throw new PosError("Der Posten steht schon auf einer Rechnung. Korrektur per Gutschrift in den Rechnungen.");
    }
    const orderRow = rows<{ id: string }>(await tx.execute(sql`SELECT id FROM pos_orders WHERE id = ${orig.orderId} AND hotel_id = ${hotelId} FOR UPDATE`));
    if (!orderRow.length) throw new PosError("Bestellung nicht gefunden.");
    const bonNo = await takeBonNo(tx, device, undefined);
    const number = receiptNumber(device.code, bonNo);
    const head = await chainHead(tx, hotelId);
    const paidAt = new Date();
    const bd = await resolveDay(tx, hotel, paidAt, null);
    const day = bd.day;
    const items = orig.items.map((x) => ({ ...x, quantity: -x.quantity }));
    const vat = orig.vat.map((v) => ({ ...v, grossRappen: -v.grossRappen, vatRappen: -v.vatRappen, netRappen: -v.netRappen }));
    const tip = -orig.tipRappen;
    const rec = { hotelId, number, seq: head.seq, kind: "reversal", reversesReceiptId: orig.id, items, totalRappen: -orig.totalRappen, vat, tipRappen: tip, businessDay: day, cashier: actor, paidAt: paidAt.toISOString() };
    const hash = hashReceipt(head.prevHash, rec);
    const [rv] = await tx.insert(posReceipts).values({ id: crypto.randomUUID(), hotelId, orderId: orig.orderId, deviceId: device.id, bonNo, number, seq: head.seq, kind: "reversal", reversesReceiptId: orig.id, items, totalRappen: -orig.totalRappen, vat, tipRappen: tip, businessDay: day, late: bd.late, cashier: actor, paidAt, prevHash: head.prevHash, hash }).returning();
    if (room) {
      // Posten aufs Zimmer gegenbuchen: die ursprünglichen Posten sind nicht auf einer Rechnung, also löschen wir sie nicht, sondern buchen negativ
      await postToRoom(tx, hotelId, room.bookingId!, { ...rv, kind: "reversal" } as PosReceipt, orig.items.map((x) => ({ ...x, quantity: -x.quantity })), orig.tipRappen, actor);
          }
    for (const p of pays) await tx.insert(posPayments).values({ hotelId, receiptId: rv.id, method: p.method, amountRappen: -p.amountRappen, bookingId: p.bookingId, folioItemIds: [] });
    await audit(tx, { hotelId, actor, action: "pos.receipt_reverse", entity: "pos_receipt", entityId: orig.id, details: { number, reason: why } });
    return rv;
  });
}

// ---------------------------------------------------------------- Tagesabschluss, Berichte, Export

export async function dayReportFor(hotelId: string, day: string): Promise<DayReport> {
  const rs = await db().select().from(posReceipts).where(and(eq(posReceipts.hotelId, hotelId), eq(posReceipts.businessDay, day)));
  const ps = rs.length ? await db().select().from(posPayments).where(and(eq(posPayments.hotelId, hotelId), inArray(posPayments.receiptId, rs.map((r) => r.id)))) : [];
  return dayReport(rs.map((r) => ({ kind: r.kind, totalRappen: r.totalRappen, tipRappen: r.tipRappen, late: r.late, vat: r.vat, payments: ps.filter((p) => p.receiptId === r.id).map((p) => ({ method: p.method, amountRappen: p.amountRappen })) })));
}

/** Z-Bericht abschliessen: Bargeld zählen, Differenz festhalten. Unveränderbar, ein Abschluss je Tag. */
export async function closeDay(hotel: Hotel, day: string, countedCashRappen: number, note: string, actor: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new PosError("Datum ungültig.");
  if (day > todayIn(hotel.timezone)) throw new PosError("Ein Tag in der Zukunft kann nicht abgeschlossen werden.");
  if (!Number.isInteger(countedCashRappen) || countedCashRappen < 0) throw new PosError("Gezähltes Bargeld ungültig.");
  const report = await dayReportFor(hotel.id, day);
  const openOrders = (await tablesOverview(hotel.id)).flatMap((t) => t.orders);
  return db().transaction(async (tx) => {
    const diff = countedCashRappen - report.expectedCashRappen;
    const [c] = await tx.insert(posDayCloses).values({ hotelId: hotel.id, day, report: { ...report, openOrders: openOrders.length, openOrdersRappen: openOrders.reduce((a, o) => a + o.openRappen, 0) }, countedCashRappen, differenceRappen: diff, note: clean(note, 300), closedBy: actor }).onConflictDoNothing().returning();
    if (!c) throw new PosError("Dieser Tag ist schon abgeschlossen.");
    await audit(tx, { hotelId: hotel.id, actor, action: "pos.day_close", entity: "pos_day_close", entityId: c.id, details: { day, differenceRappen: diff } });
    return c;
  });
}

export const listDayCloses = (hotelId: string) => db().select().from(posDayCloses).where(eq(posDayCloses.hotelId, hotelId)).orderBy(desc(posDayCloses.day)).limit(60);

export async function receiptsOfDay(hotelId: string, day: string) {
  const rs = await db().select().from(posReceipts).where(and(eq(posReceipts.hotelId, hotelId), eq(posReceipts.businessDay, day))).orderBy(asc(posReceipts.seq));
  const ps = rs.length ? await db().select().from(posPayments).where(and(eq(posPayments.hotelId, hotelId), inArray(posPayments.receiptId, rs.map((r) => r.id)))) : [];
  return rs.map((r) => ({ receipt: r, payments: ps.filter((p) => p.receiptId === r.id) }));
}

/** Prüfung der Hash-Kette eines Betriebs: Nummer (seq) des ersten fehlerhaften Bons oder null; dazu Lücken je Gerät */
export async function verifyHotel(hotelId: string) {
  const rs = await db().select().from(posReceipts).where(eq(posReceipts.hotelId, hotelId)).orderBy(asc(posReceipts.seq));
  const broken = verifyChain(rs.map((r) => ({ hotelId: r.hotelId, number: r.number, seq: r.seq, kind: r.kind, reversesReceiptId: r.reversesReceiptId, items: r.items, totalRappen: r.totalRappen, vat: r.vat, tipRappen: r.tipRappen, businessDay: r.businessDay, cashier: r.cashier, paidAt: r.paidAt.toISOString(), prevHash: r.prevHash, hash: r.hash })));
  const devices = await listDevices(hotelId);
  const gaps = devices.map((d) => ({ code: d.code, gaps: bonGaps(rs.filter((r) => r.deviceId === d.id).map((r) => r.bonNo)) })).filter((g) => g.gaps.length);
  return { receipts: rs.length, brokenAtSeq: broken, gaps };
}

/** Export für die Revision (CSV, eine Zeile je Bon) */
export async function exportCsv(hotelId: string, from: string, to: string): Promise<string> {
  const rs = await db().select().from(posReceipts).where(and(eq(posReceipts.hotelId, hotelId), sql`${posReceipts.businessDay} >= ${from}`, sql`${posReceipts.businessDay} <= ${to}`)).orderBy(asc(posReceipts.seq));
  const ps = rs.length ? await db().select().from(posPayments).where(and(eq(posPayments.hotelId, hotelId), inArray(posPayments.receiptId, rs.map((r) => r.id)))) : [];
  const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  const chf = (r: number) => (r / 100).toFixed(2);
  const head = ["Nummer", "Folge", "Geschäftstag", "Zeitpunkt", "Art", "Gegenbon zu", "Total CHF", "Trinkgeld CHF", "Zahlung", "MWST-Sätze", "Verspätet", "Kassier", "Hash"];
  const lines = rs.map((r) => [
    r.number, r.seq, r.businessDay, r.paidAt.toISOString(), r.kind === "sale" ? "Verkauf" : "Gegenbon", r.reversesReceiptId ?? "", chf(r.totalRappen), chf(r.tipRappen),
    ps.filter((p) => p.receiptId === r.id).map((p) => `${p.method}:${chf(p.amountRappen)}`).join(" "),
    r.vat.map((v) => `${(v.bps / 100).toFixed(1)}%:${chf(v.grossRappen)}/${chf(v.vatRappen)}`).join(" "), r.late ? "ja" : "nein", r.cashier, r.hash,
  ].map(q).join(";"));
  return "﻿" + [head.map(q).join(";"), ...lines].join("\r\n") + "\r\n";
}
