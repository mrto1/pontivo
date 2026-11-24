import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { insertFolioItem } from "./folio";
import { db, rows } from "../db/client";
import {
  bookings, folioItems, posDayCloses, posDevices, posItemGroups, posItems, posLineDone, posOptionGroups, posOptions, posOrderLines, posOrders, posPayments, posReceipts, posTables,
  type Hotel, type PosDevice, type PosItem, type PosOrder, type PosOrderLine, type PosReceipt, type PosTable, type PosReceiptItem,
} from "../db/schema";
import { todayIn } from "../domain/dates";
import {
  METHODS, bonGaps, businessDay, checkSelection, dayReport, openTotalRappen, outstanding, receiptNumber, selectionTotal,
  type DayReport, type Line, type Method, type Selection,
} from "../domain/pos";
import { GENESIS_HASH, hashReceipt, verifyChain } from "../domain/pos-chain";
import { checkChoice, composeLine, NOTE_MAX, type ChosenOption, type GroupDef } from "../domain/pos-options";
import { posStockMove } from "./goods";
import { audit } from "./audit";
import { invoicingSettings } from "./invoicing";
import { RoomLinkError, activeLink, chargeRemote } from "./room-link";

/**
 * Restaurant und Kasse (SPEC 19.16). Bestellzeilen, Bons, Zahlungen und Tagesabschlüsse werden nur angehängt (Datenbank-Trigger sperren
 * Änderungen); Korrekturen sind Stornozeilen und Gegenbons. Jede Abfrage nach hotel_id.
 */
export class PosError extends Error {}

const clean = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);

// ---------------------------------------------------------------- Artikel, Tische, Geräte

export type ItemInput = { category?: string; name: string; priceRappen: number; vatDineInBps: number; vatTakeawayBps: number; dailySpecial?: boolean; active?: boolean; sortOrder?: number; station?: "kitchen" | "bar" | "none" };

export const listItems = (hotelId: string, onlyActive = false) =>
  db().select().from(posItems).where(onlyActive ? and(eq(posItems.hotelId, hotelId), eq(posItems.active, true)) : eq(posItems.hotelId, hotelId)).orderBy(asc(posItems.category), asc(posItems.sortOrder), asc(posItems.name));

export async function saveItem(hotelId: string, id: string | null, i: ItemInput, actor: string): Promise<PosItem> {
  const name = clean(i.name, 120);
  if (!name) throw new PosError("Der Name fehlt.");
  if (!Number.isInteger(i.priceRappen) || i.priceRappen < 0 || i.priceRappen > 10_000_000) throw new PosError("Preis ungültig.");
  for (const b of [i.vatDineInBps, i.vatTakeawayBps]) if (!Number.isInteger(b) || b < 0 || b > 2500) throw new PosError("MWST-Satz ungültig (0 bis 25 %).");
  const v = { category: clean(i.category, 60), name, priceRappen: i.priceRappen, vatDineInBps: i.vatDineInBps, vatTakeawayBps: i.vatTakeawayBps, dailySpecial: i.dailySpecial ?? false, active: i.active ?? true, sortOrder: i.sortOrder ?? 0, ...(i.station ? { station: i.station } : {}) };
  if (i.station && !["kitchen", "bar", "none"].includes(i.station)) throw new PosError("Station ungültig.");
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

/** Plätze und Form eines Tisches (SPEC 19.49 Etappe C) */
export async function saveTableDetails(hotelId: string, id: string, i: { seats: number; shape: "square" | "round" }, actor: string) {
  if (!Number.isInteger(i.seats) || i.seats < 1 || i.seats > 50) throw new PosError("Plätze: 1 bis 50.");
  if (i.shape !== "square" && i.shape !== "round") throw new PosError("Form ungültig.");
  const [t] = await db().update(posTables).set({ seats: i.seats, shape: i.shape }).where(and(eq(posTables.id, id), eq(posTables.hotelId, hotelId))).returning();
  if (!t) throw new PosError("Tisch nicht gefunden.");
  await audit(db(), { hotelId, actor, action: "pos.table_update", entity: "pos_table", entityId: id });
}

/** Lage der Tische im Plan speichern (Promille der Fläche); x/y null = nicht im Plan */
export async function saveTablePlan(hotelId: string, positions: { id: string; x: number | null; y: number | null }[], actor: string) {
  for (const p of positions) {
    const ok = (v: number | null) => v === null || (Number.isInteger(v) && v >= 0 && v <= 1000);
    if (!ok(p.x) || !ok(p.y) || (p.x === null) !== (p.y === null)) throw new PosError("Position ungültig.");
  }
  await db().transaction(async (tx) => {
    for (const p of positions) await tx.update(posTables).set({ planX: p.x, planY: p.y }).where(and(eq(posTables.id, p.id), eq(posTables.hotelId, hotelId)));
    await audit(tx, { hotelId, actor, action: "pos.table_plan", entity: "pos_table", entityId: hotelId, details: { tables: positions.length } });
  });
}

/** CSV-Import Artikel (alles oder nichts, SPEC 19.48): Artikel mit gleichem Namen und gleicher Kategorie gibt es schon und werden übersprungen */
export async function importItems(hotelId: string, rowsIn: import("../domain/pos-import").PosItemRow[], actor: string): Promise<{ created: number; skipped: number }> {
  return db().transaction(async (tx) => {
    const have = await tx.select({ category: posItems.category, name: posItems.name }).from(posItems).where(eq(posItems.hotelId, hotelId));
    const key = (c: string, n: string) => `${c.toLowerCase()}\u0000${n.toLowerCase()}`;
    const seen = new Set(have.map((h) => key(h.category, h.name)));
    let created = 0, skipped = 0;
    const base = have.length;
    for (const r of rowsIn) {
      if (seen.has(key(r.category, r.name))) { skipped++; continue; }
      seen.add(key(r.category, r.name));
      await tx.insert(posItems).values({ hotelId, category: r.category, name: r.name, priceRappen: r.priceRappen, vatDineInBps: r.vatDineInBps, vatTakeawayBps: r.vatTakeawayBps, dailySpecial: r.dailySpecial, active: true, sortOrder: base + created });
      created++;
    }
    await audit(tx, { hotelId, actor, action: "pos.items_import", details: { created, skipped } });
    return { created, skipped };
  });
}

/** CSV-Import Tische: vorhandene Namen werden übersprungen */
export async function importTables(hotelId: string, names: string[], actor: string): Promise<{ created: number; skipped: number }> {
  return db().transaction(async (tx) => {
    const have = new Set((await tx.select({ name: posTables.name }).from(posTables).where(eq(posTables.hotelId, hotelId))).map((t) => t.name.toLowerCase()));
    let created = 0, skipped = 0;
    for (const n of names) {
      if (have.has(n.toLowerCase())) { skipped++; continue; }
      await tx.insert(posTables).values({ hotelId, name: n, sortOrder: have.size + created });
      created++;
    }
    await audit(tx, { hotelId, actor, action: "pos.tables_import", details: { created, skipped } });
    return { created, skipped };
  });
}

// ---------------------------------------------------------------- Optionen, Sonderwünsche, Menüs (SPEC 19.49)

/** Gruppen mit Optionen, die für einen Artikel gelten (nur aktive), in der Reihenfolge der Zuordnung */
export async function groupsOfItem(ex: Ex, hotelId: string, itemId: string): Promise<GroupDef[]> {
  const links = await ex.select({ g: posOptionGroups }).from(posItemGroups).innerJoin(posOptionGroups, eq(posOptionGroups.id, posItemGroups.groupId))
    .where(and(eq(posItemGroups.hotelId, hotelId), eq(posItemGroups.itemId, itemId), eq(posOptionGroups.active, true))).orderBy(asc(posItemGroups.sortOrder), asc(posOptionGroups.sortOrder), asc(posOptionGroups.name));
  if (!links.length) return [];
  const opts = await ex.select().from(posOptions).where(and(eq(posOptions.hotelId, hotelId), inArray(posOptions.groupId, links.map((l) => l.g.id)), eq(posOptions.active, true))).orderBy(asc(posOptions.sortOrder), asc(posOptions.name));
  return links.map(({ g }) => ({ id: g.id, name: g.name, required: g.required, maxChoices: g.maxChoices, options: opts.filter((o) => o.groupId === g.id).map((o) => ({ id: o.id, name: o.name, priceRappen: o.priceRappen })) }));
}

/** Alle Gruppen eines Betriebs mit Optionen und zugeordneten Artikeln (Einrichtung) */
export async function listOptionGroups(hotelId: string) {
  const groups = await db().select().from(posOptionGroups).where(eq(posOptionGroups.hotelId, hotelId)).orderBy(asc(posOptionGroups.sortOrder), asc(posOptionGroups.name));
  const opts = await db().select().from(posOptions).where(eq(posOptions.hotelId, hotelId)).orderBy(asc(posOptions.sortOrder), asc(posOptions.name));
  const links = await db().select().from(posItemGroups).where(eq(posItemGroups.hotelId, hotelId));
  return groups.map((g) => ({ ...g, options: opts.filter((o) => o.groupId === g.id), itemIds: links.filter((l) => l.groupId === g.id).map((l) => l.itemId) }));
}

/** Katalog für die Offline-Kasse: je Artikel seine Gruppen (nur aktive Artikel) */
export async function catalogGroups(hotelId: string, itemIds: string[]): Promise<Map<string, GroupDef[]>> {
  const out = new Map<string, GroupDef[]>();
  if (!itemIds.length) return out;
  const all = await listOptionGroups(hotelId);
  for (const id of itemIds) {
    const gs = all.filter((g) => g.active && g.itemIds.includes(id)).map((g) => ({ id: g.id, name: g.name, required: g.required, maxChoices: g.maxChoices, options: g.options.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name, priceRappen: o.priceRappen })) }));
    if (gs.length) out.set(id, gs);
  }
  return out;
}

export async function saveOptionGroup(hotelId: string, id: string | null, i: { name: string; required: boolean; maxChoices: number; active?: boolean }, actor: string) {
  const name = clean(i.name, 60);
  if (!name) throw new PosError("Der Name fehlt.");
  if (!Number.isInteger(i.maxChoices) || i.maxChoices < 1 || i.maxChoices > 20) throw new PosError("Höchstens zu wählen: 1 bis 20.");
  const v = { name, required: i.required, maxChoices: i.maxChoices, active: i.active ?? true };
  try {
    const [g] = id
      ? await db().update(posOptionGroups).set(v).where(and(eq(posOptionGroups.id, id), eq(posOptionGroups.hotelId, hotelId))).returning()
      : await db().insert(posOptionGroups).values({ ...v, hotelId, sortOrder: (await db().select({ id: posOptionGroups.id }).from(posOptionGroups).where(eq(posOptionGroups.hotelId, hotelId))).length }).returning();
    if (!g) throw new PosError("Gruppe nicht gefunden.");
    await audit(db(), { hotelId, actor, action: id ? "pos.group_update" : "pos.group_create", entity: "pos_option_group", entityId: g.id });
    return g;
  } catch (e) {
    if ((e as { code?: string }).code === "23505" || /unique/i.test((e as Error).message)) throw new PosError("Diese Gruppe gibt es schon.");
    throw e;
  }
}

export async function saveOption(hotelId: string, groupId: string, i: { name: string; priceRappen: number }, actor: string) {
  const name = clean(i.name, 60);
  if (!name) throw new PosError("Der Name fehlt.");
  if (!Number.isInteger(i.priceRappen) || i.priceRappen < 0 || i.priceRappen > 1_000_000) throw new PosError("Aufpreis ungültig.");
  const [g] = await db().select({ id: posOptionGroups.id }).from(posOptionGroups).where(and(eq(posOptionGroups.id, groupId), eq(posOptionGroups.hotelId, hotelId)));
  if (!g) throw new PosError("Gruppe nicht gefunden.");
  const [o] = await db().insert(posOptions).values({ hotelId, groupId, name, priceRappen: i.priceRappen, sortOrder: (await db().select({ id: posOptions.id }).from(posOptions).where(eq(posOptions.groupId, groupId))).length }).onConflictDoNothing().returning();
  if (!o) throw new PosError("Diese Option gibt es in der Gruppe schon.");
  await audit(db(), { hotelId, actor, action: "pos.option_create", entity: "pos_option", entityId: o.id });
  return o;
}

export async function setOptionActive(hotelId: string, optionId: string, active: boolean, actor: string) {
  const [o] = await db().update(posOptions).set({ active }).where(and(eq(posOptions.id, optionId), eq(posOptions.hotelId, hotelId))).returning();
  if (!o) throw new PosError("Option nicht gefunden.");
  await audit(db(), { hotelId, actor, action: "pos.option_update", entity: "pos_option", entityId: o.id, details: { active } });
}

/** Artikel einer Gruppe zuordnen (ersetzt die bisherige Zuordnung der Gruppe) */
export async function setGroupItems(hotelId: string, groupId: string, itemIds: string[], actor: string) {
  await db().transaction(async (tx) => {
    const [g] = await tx.select({ id: posOptionGroups.id }).from(posOptionGroups).where(and(eq(posOptionGroups.id, groupId), eq(posOptionGroups.hotelId, hotelId)));
    if (!g) throw new PosError("Gruppe nicht gefunden.");
    const valid = itemIds.length ? (await tx.select({ id: posItems.id }).from(posItems).where(and(eq(posItems.hotelId, hotelId), inArray(posItems.id, itemIds)))).map((x) => x.id) : [];
    await tx.delete(posItemGroups).where(and(eq(posItemGroups.hotelId, hotelId), eq(posItemGroups.groupId, groupId)));
    if (valid.length) await tx.insert(posItemGroups).values(valid.map((itemId, n) => ({ hotelId, itemId, groupId, sortOrder: n })));
    await audit(tx, { hotelId, actor, action: "pos.group_items", entity: "pos_option_group", entityId: groupId, details: { items: valid.length } });
  });
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

/** Gerät der Weboberfläche (Bon-Nummernkreis «W1»); wird beim ersten Kassieren angelegt. */
export async function webDevice(hotelId: string): Promise<PosDevice> {
  const [d] = await db().select().from(posDevices).where(and(eq(posDevices.hotelId, hotelId), eq(posDevices.code, "W1")));
  return d ?? createDevice(hotelId, "W1", "Weboberfläche", "system");
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

/** `snapshot`: Preis, Satz und Text, wie sie dem Gast am Gerät galten (Offline-Kasse); sonst gilt der Artikel jetzt. */
export type LineInput = {
  id?: string; itemId: string; quantity: number; mode?: "dine_in" | "takeaway"; deviceAt?: Date | null; snapshot?: { description: string; unitPriceRappen: number; vatBps: number };
  /** gewählte Optionen (Ids) und Sonderwunsch (SPEC 19.49); Text und Preis rechnet der Server, ausser bei einem Offline-Snapshot */
  optionIds?: string[]; note?: string;
  /** Offline-Kasse: schon gewählte Optionen (Stand des Geräts); der Server prüft sie dann nicht erneut */
  optionsSnapshot?: ChosenOption[];
};

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
      let bps = vatLiable ? (mode === "takeaway" ? it.vatTakeawayBps : it.vatDineInBps) : 0;
      let price = it.priceRappen, text = it.name;
      const groups = await groupsOfItem(tx, hotel.id, it.id);
      const optionIds = i.optionIds ?? [];
      if (i.note && i.note.trim().length > NOTE_MAX) throw new PosError(`Sonderwunsch: höchstens ${NOTE_MAX} Zeichen.`);
      let comp = composeLine(it, groups, optionIds, i.note ?? "");
      if (i.snapshot) comp = { ...comp, options: i.optionsSnapshot ?? [], note: (i.note ?? "").trim().slice(0, NOTE_MAX) }; // verkauft ist verkauft: das Gerät hat die Auswahl schon geprüft
      else { const bad = checkChoice(groups, optionIds); if (bad) throw new PosError(bad); }
      price = comp.unitPriceRappen; text = comp.description;
      if (i.snapshot) {
        const sn = i.snapshot;
        if (!Number.isInteger(sn.unitPriceRappen) || sn.unitPriceRappen < 0 || sn.unitPriceRappen > 10_000_000) throw new PosError("Preis ungültig.");
        if (!Number.isInteger(sn.vatBps) || sn.vatBps < 0 || sn.vatBps > 2500) throw new PosError("MWST-Satz ungültig.");
        price = sn.unitPriceRappen; text = clean(sn.description, 120) || comp.description; bps = vatLiable ? sn.vatBps : 0;
      }
      const id = i.id ?? crypto.randomUUID();
      const ins = await tx.insert(posOrderLines).values({ id, hotelId: hotel.id, orderId, itemId: it.id, description: text, quantity: i.quantity, unitPriceRappen: price, vatBps: bps, mode, createdBy: actor, deviceAt: i.deviceAt ?? null, options: comp.options.length ? comp.options : null, note: comp.note }).onConflictDoNothing().returning();
      if (ins.length) { out.push(ins[0]); await posStockMove(tx, hotel.id, [{ itemId: it.id, quantity: i.quantity }], -1); }
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
    await posStockMove(tx, hotelId, [{ itemId: l.itemId, quantity }], 1);
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
  /** Offline-Bon: der Gast hat schon bezahlt, auch wenn die Buchung nicht mehr gefunden wird (dann ohne Zuordnung, Manager prüft) */ lenientRoom?: boolean;
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
    let viaLink = false;
    if (roomPay) {
      const [b] = await tx.select({ id: bookings.id, status: bookings.status }).from(bookings).where(and(eq(bookings.hotelId, hotelId), eq(bookings.reference, (i.bookingReference ?? "").trim().toUpperCase())));
      if (b && b.status === "confirmed") bookingId = b.id;
      else if (!b && (i.bookingReference ?? "").trim() && (await activeLink(hotelId))) viaLink = true; // Buchung beim verbundenen Hotel (SPEC 20.10)
      else if (!i.lenientRoom) throw new PosError("Buchung für «aufs Zimmer» nicht gefunden oder nicht bestätigt.");
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
    let remote: { linkId: string; reference: string } | null = null;
    if (viaLink) {
      try { remote = await chargeRemote(hotelId, hotel.name, i.bookingReference ?? "", receipt, items, tip); }
      catch (e) { if (!(e instanceof RoomLinkError)) throw e; if (!i.lenientRoom) throw new PosError(e.message); }
    }
    for (const p of i.payments) await tx.insert(posPayments).values({ hotelId, receiptId, method: p.method, amountRappen: p.amountRappen, bookingId, folioItemIds: p.method === "room" ? folioIds : [], ...(p.method === "room" && remote ? { remoteLinkId: remote.linkId, remoteReference: remote.reference } : {}) });
    await audit(tx, { hotelId, actor, action: "pos.pay", entity: "pos_receipt", entityId: receiptId, details: { number, totalRappen: t.totalRappen, methods: i.payments.map((p) => p.method), ...(roomPay && !bookingId && !remote ? { unassignedRoom: i.bookingReference ?? "" } : {}), ...(remote ? { roomLink: remote.linkId, remoteReference: remote.reference } : {}) } });
    return receipt;
  });
}

/** Posten aufs Zimmer: je Bon-Zeile ein Posten mit dem MWST-Satz der Zeile; Trinkgeld ohne MWST. Idempotent über die externe Id. */
async function postToRoom(tx: Tx, hotelId: string, bookingId: string, receipt: PosReceipt, items: PosReceiptItem[], tip: number, actor: string): Promise<string[]> {
  const ids: string[] = [];
  for (const it of items) {
    const f = (await insertFolioItem(tx, { hotelId, bookingId, description: `${it.description} (Restaurant ${receipt.number})`, quantity: it.quantity, unitPriceRappen: it.unitPriceRappen, vatKind: "standard", vatBpsOverride: it.vatBps, externalId: `pos:${receipt.id}:${it.lineId}`, source: "pos", createdBy: actor }))!;
    ids.push(f.id);
  }
  if (tip) {
    const f = (await insertFolioItem(tx, { hotelId, bookingId, description: `Trinkgeld (Restaurant ${receipt.number})`, quantity: receipt.kind === "reversal" ? -1 : 1, unitPriceRappen: tip, vatKind: "none", externalId: `pos:${receipt.id}:tip`, source: "pos", createdBy: actor }))!;
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
    if (room?.bookingId) {
      // Posten aufs Zimmer gegenbuchen: die ursprünglichen Posten sind nicht auf einer Rechnung, also löschen wir sie nicht, sondern buchen negativ
      await postToRoom(tx, hotelId, room.bookingId, { ...rv, kind: "reversal" } as PosReceipt, orig.items.map((x) => ({ ...x, quantity: -x.quantity })), orig.tipRappen, actor);
    } else if (room?.remoteLinkId && room.remoteReference) {
      // Beim verbundenen Hotel gegenbuchen (SPEC 20.10)
      try { await chargeRemote(hotelId, hotel.name, room.remoteReference, rv, items, orig.tipRappen, orig.id, room.remoteLinkId); }
      catch (e) { if (!(e instanceof RoomLinkError)) throw e; throw new PosError(e.message); }
    }
    // Gegenbon: Waren mit Lager kommen zurück ins Lager (Menge je Zeile aus dem Bon)
    const lineRows = await tx.select({ id: posOrderLines.id, itemId: posOrderLines.itemId }).from(posOrderLines).where(and(eq(posOrderLines.orderId, orig.orderId), eq(posOrderLines.hotelId, hotelId)));
    await posStockMove(tx, hotelId, orig.items.map((x) => ({ itemId: lineRows.find((l) => l.id === x.lineId)?.itemId ?? null, quantity: x.quantity })), 1);
    for (const p of pays) await tx.insert(posPayments).values({ hotelId, receiptId: rv.id, method: p.method, amountRappen: -p.amountRappen, bookingId: p.bookingId, folioItemIds: [], remoteLinkId: p.remoteLinkId, remoteReference: p.remoteReference });
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

/** Gerät wieder freigeben (anderes Tablet übernimmt den Nummernkreis). Nur Manager (Seite prüft die Rolle). */
export async function releaseDevice(hotelId: string, deviceId: string, actor: string) {
  const [d] = await db().update(posDevices).set({ claimedKey: null }).where(and(eq(posDevices.id, deviceId), eq(posDevices.hotelId, hotelId))).returning({ code: posDevices.code });
  if (!d) throw new PosError("Gerät nicht gefunden.");
  await audit(db(), { hotelId, actor, action: "pos.device_release", entity: "pos_device", entityId: deviceId, details: { code: d.code } });
}

// ---------------------------------------------------------------- Küchenbildschirm (SPEC 19.49 Etappe B)

export type Station = "kitchen" | "bar";
export type Ticket = { orderId: string; label: string; table: string | null; since: Date; lines: { id: string; quantity: number; description: string; note: string; mode: "dine_in" | "takeaway"; at: Date }[] };

/** Offene Zeilen einer Station, nach Bestellung gruppiert, älteste zuerst. Stornierte Zeilen (Menge netto 0) und erledigte fehlen. */
export async function openTickets(hotelId: string, station: Station): Promise<Ticket[]> {
  const r = rows<{ id: string; order_id: string; description: string; quantity: number; note: string; mode: "dine_in" | "takeaway"; created_at: Date; label: string; table_name: string | null }>(await db().execute(sql`
    SELECT l.id, l.order_id, l.description, l.quantity, l.note, l.mode, l.created_at, o.label, t.name AS table_name
      FROM pos_order_lines l
      JOIN pos_items i ON i.id = l.item_id AND i.hotel_id = l.hotel_id
      JOIN pos_orders o ON o.id = l.order_id AND o.hotel_id = l.hotel_id
      LEFT JOIN pos_tables t ON t.id = o.table_id AND t.hotel_id = o.hotel_id
     WHERE l.hotel_id = ${hotelId} AND l.reverses_line_id IS NULL AND l.quantity > 0 AND i.station = ${station}
       AND l.created_at > now() - interval '1 day'
       AND NOT EXISTS (SELECT 1 FROM pos_line_done d WHERE d.line_id = l.id AND d.hotel_id = l.hotel_id)
       AND l.quantity + coalesce((SELECT sum(x.quantity) FROM pos_order_lines x WHERE x.reverses_line_id = l.id AND x.hotel_id = l.hotel_id), 0) > 0
     ORDER BY l.created_at, l.id`));
  const by = new Map<string, Ticket>();
  for (const x of r) {
    const t = by.get(x.order_id) ?? { orderId: x.order_id, label: x.label, table: x.table_name, since: new Date(x.created_at), lines: [] };
    t.lines.push({ id: x.id, quantity: x.quantity, description: x.description, note: x.note, mode: x.mode, at: new Date(x.created_at) });
    by.set(x.order_id, t);
  }
  return [...by.values()];
}

/** Zeilen als fertig melden (je Zeile einmal, Wiederholung unschädlich) */
export async function markDone(hotelId: string, lineIds: string[], actor: string) {
  if (!lineIds.length) return 0;
  const valid = await db().select({ id: posOrderLines.id }).from(posOrderLines).where(and(eq(posOrderLines.hotelId, hotelId), inArray(posOrderLines.id, lineIds)));
  if (!valid.length) throw new PosError("Zeile nicht gefunden.");
  await db().insert(posLineDone).values(valid.map((v) => ({ lineId: v.id, hotelId, doneBy: actor }))).onConflictDoNothing();
  return valid.length;
}
