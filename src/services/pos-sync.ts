import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { posDevices, posOrders, type Hotel } from "../db/schema";
import { todayIn } from "../domain/dates";
import type { SyncOp, SyncResult } from "../domain/pos-offline";
import { PosError, addLines, listItems, listTables, openOrder, orderView, pay } from "./pos";
import { audit } from "./audit";

/** Offline-Kasse: Daten zum Mitnehmen und Übertragung der lokal gesammelten Vorgänge (SPEC 19.16). Jede Abfrage nach hotel_id. */
export class DeviceError extends Error {}

/** Gerät für diesen Browser (Schlüssel) belegen oder bestätigen. Ein Code gehört genau einem Browser, sonst entstünden doppelte Bon-Nummern. */
async function claim(hotelId: string, code: string, key: string) {
  const [d] = await db().select().from(posDevices).where(and(eq(posDevices.hotelId, hotelId), eq(posDevices.code, code)));
  if (!d) throw new DeviceError("Gerät nicht gefunden.");
  if (d.claimedKey && d.claimedKey !== key) throw new DeviceError(`Das Gerät ${code} wird schon von einem anderen Gerät benutzt. Ein Manager kann es unter Einstellungen → Technik → Geräte & Kasse → Kassen-Geräte freigeben.`);
  if (!d.claimedKey) {
    const [u] = await db().update(posDevices).set({ claimedKey: key }).where(and(eq(posDevices.id, d.id), isNull(posDevices.claimedKey))).returning();
    if (!u) throw new DeviceError(`Das Gerät ${code} wurde gerade von einem anderen Gerät belegt.`);
    await audit(db(), { hotelId, actor: "device", action: "pos.device_claim", entity: "pos_device", entityId: d.id, details: { code } });
    return u;
  }
  return d;
}

/** Gäste im Haus (für «aufs Zimmer» ohne Verbindung): Referenz, Name, Zimmer. Nur bestätigte Buchungen, heute im Haus oder Abreise heute. */
async function guestsInHouse(hotel: Hotel) {
  const today = todayIn(hotel.timezone);
  return rows<{ reference: string; name: string; room: string | null }>(await db().execute(sql`
    SELECT b.reference, trim(coalesce(g.first_name,'') || ' ' || coalesce(g.last_name,'')) AS name, min(r.number) AS room
      FROM bookings b
      LEFT JOIN guests g ON g.id = b.guest_id AND g.hotel_id = b.hotel_id
      LEFT JOIN room_stays rs ON rs.booking_id = b.id AND rs.hotel_id = b.hotel_id AND rs.from_day <= ${today} AND rs.to_day >= ${today}
      LEFT JOIN rooms r ON r.id = rs.room_id AND r.hotel_id = rs.hotel_id
     WHERE b.hotel_id = ${hotel.id} AND b.status = 'confirmed' AND b.checkin <= ${today} AND b.checkout >= ${today}
     GROUP BY b.id, b.reference, g.first_name, g.last_name
     ORDER BY min(r.number) NULLS LAST, b.reference LIMIT 400`));
}

/** Offene Bestellungen mit Zeilen (Stand des Servers) */
async function openOrders(hotelId: string) {
  const os = await db().select().from(posOrders).where(eq(posOrders.hotelId, hotelId)).orderBy(asc(posOrders.openedAt));
  const out = [];
  for (const o of os.slice(-300)) {
    const v = await orderView(hotelId, o.id);
    if (!v || v.openTotalRappen <= 0) continue;
    out.push({ id: o.id, tableId: o.tableId, label: o.label, lines: v.lines.map(({ line, openQuantity }) => ({ id: line.id, itemId: line.itemId, description: line.description, quantity: line.quantity, unitPriceRappen: line.unitPriceRappen, vatBps: line.vatBps, mode: line.mode, openQuantity })) });
  }
  return out;
}

export async function bootstrap(hotel: Hotel, key: string, code?: string) {
  const devices = await db().select().from(posDevices).where(eq(posDevices.hotelId, hotel.id)).orderBy(asc(posDevices.code));
  const list = devices.map((d) => ({ code: d.code, label: d.label, mine: d.claimedKey === key, free: !d.claimedKey }));
  if (!code) return { devices: list };
  const dev = await claim(hotel.id, code, key);
  await db().update(posDevices).set({ lastSeenAt: new Date() }).where(eq(posDevices.id, dev.id));
  const [items, tables, guests, orders] = await Promise.all([listItems(hotel.id, true), listTables(hotel.id), guestsInHouse(hotel), openOrders(hotel.id)]);
  return {
    devices: list, device: { code: dev.code, lastBon: dev.lastBon }, today: todayIn(hotel.timezone),
    items: items.map((i) => ({ id: i.id, category: i.category, name: i.name, priceRappen: i.priceRappen, vatDineInBps: i.vatDineInBps, vatTakeawayBps: i.vatTakeawayBps, dailySpecial: i.dailySpecial })),
    tables: tables.map((t) => ({ id: t.id, name: t.name })), guests, orders,
  };
}

/** Vorgänge eines Geräts der Reihe nach übernehmen. Jeder Vorgang einzeln: ein abgelehnter hält die anderen nicht auf. Wiederholungen sind unschädlich. */
export async function syncOps(hotel: Hotel, key: string, code: string, pending: number, ops: SyncOp[], actor: string): Promise<SyncResult[]> {
  const dev = await claim(hotel.id, code, key);
  const results: SyncResult[] = [];
  for (const op of ops) {
    try {
      const at = new Date(op.at);
      if (op.kind === "order") await openOrder(hotel.id, { id: op.id, tableId: op.tableId, deviceId: dev.id, label: op.label, deviceAt: at }, actor);
      else if (op.kind === "lines") await addLines(hotel, op.orderId, op.lines.map((l) => ({ id: l.id, itemId: l.itemId, quantity: l.quantity, mode: l.mode, deviceAt: at, snapshot: { description: l.description, unitPriceRappen: l.unitPriceRappen, vatBps: l.vatBps } })), actor);
      else await pay(hotel, { orderId: op.orderId, deviceId: dev.id, selection: op.selection, payments: op.payments, tipRappen: op.tipRappen, bookingReference: op.bookingReference, receiptId: op.receiptId, bonNo: op.bonNo, deviceAt: at, lenientRoom: true }, actor);
      results.push({ id: op.id, ok: true });
    } catch (e) {
      if (!(e instanceof PosError)) throw e;
      results.push({ id: op.id, ok: false, error: e.message });
      // Eine abgelehnte Zahlung hinterlässt eine Lücke in den Bon-Nummern: der Grund bleibt im Protokoll nachvollziehbar
      await audit(db(), { hotelId: hotel.id, actor, action: "pos.sync_rejected", entity: "pos_device", entityId: dev.id, details: { kind: op.kind, opId: op.id, error: e.message, ...(op.kind === "pay" ? { bonNo: op.bonNo, number: `${code}-${String(op.bonNo).padStart(6, "0")}` } : {}) } });
    }
  }
  await db().update(posDevices).set({ lastSeenAt: new Date(), pendingOps: Math.max(0, pending - results.filter((r) => r.ok).length) }).where(eq(posDevices.id, dev.id));
  return results;
}

/** Für den Kassenabschluss: Geräte mit nicht übertragenen Vorgängen, abgelehnte Bons, Zimmerbons ohne Zuordnung */
export async function offlineWarnings(hotelId: string) {
  const devices = await db().select().from(posDevices).where(eq(posDevices.hotelId, hotelId)).orderBy(asc(posDevices.code));
  const unsynced = devices.filter((d) => d.pendingOps > 0).map((d) => ({ code: d.code, pending: d.pendingOps, lastSeenAt: d.lastSeenAt }));
  const rejected = rows<{ number: string | null; error: string; at: Date }>(await db().execute(sql`
    SELECT details->>'number' AS number, details->>'error' AS error, created_at AS at FROM audit_log
     WHERE hotel_id = ${hotelId} AND action = 'pos.sync_rejected' AND details->>'kind' = 'pay' ORDER BY id DESC LIMIT 30`));
  const unassigned = rows<{ number: string; total: number; day: string }>(await db().execute(sql`
    SELECT r.number, p.amount_rappen AS total, r.business_day::text AS day FROM pos_payments p JOIN pos_receipts r ON r.id = p.receipt_id
     WHERE p.hotel_id = ${hotelId} AND p.method = 'room' AND p.booking_id IS NULL ORDER BY r.seq DESC LIMIT 50`));
  return { unsynced, rejected, unassigned };
}
