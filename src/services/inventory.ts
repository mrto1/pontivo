import { and, eq, sql } from "drizzle-orm";
import { db, type Executor } from "../db/client";
import { hotels, inventoryDays, ratePlans, ratesDays, roomTypes } from "../db/schema";
import { addDays, nightsOf, todayIn, weekday } from "../domain/dates";
import { enqueueAvailability, enqueueRestrictions, type RestrictionField } from "./outbox";
import { audit } from "./audit";

export const HORIZON_DAYS = 548; // ~18 Monate (SPEC 4)

/** inventory_days für einen Zimmertyp anlegen (fehlende Tage, total = room_count) */
export async function ensureInventory(ex: Executor, hotelId: string, roomTypeId: string, from: string, toExclusive: string) {
  await ex.execute(sql`
    INSERT INTO inventory_days (hotel_id, room_type_id, night, total)
    SELECT ${hotelId}, rt.id, d::date, rt.room_count
      FROM room_types rt, generate_series(${from}::date, ${toExclusive}::date - 1, interval '1 day') d
     WHERE rt.id = ${roomTypeId} AND rt.hotel_id = ${hotelId}
    ON CONFLICT DO NOTHING`);
}

/**
 * Täglicher Job: Horizont auf 18 Monate auffüllen.
 * Fehlende rates_days werden vom gleichen Wochentag eine Woche vorher übernommen.
 */
// ASSUMPTION: Preis/Regeln für neue Tage = Wert 7 Tage vorher (gleicher Wochentag). Fehlt dieser, bleibt der Tag unbuchbar.
export async function extendHorizon(now: Date = new Date()) {
  const all = await db().select().from(hotels);
  for (const h of all) {
    const today = todayIn(h.timezone, now);
    const end = addDays(today, HORIZON_DAYS);
    const rts = await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, h.id), eq(roomTypes.active, true)));
    for (const rt of rts) await ensureInventory(db(), h.id, rt.id, today, end);
    await db().execute(sql`
      INSERT INTO rates_days (hotel_id, rate_plan_id, night, price_rappen, min_stay_arrival, max_stay, closed_to_arrival, closed_to_departure, stop_sell)
      SELECT r.hotel_id, r.rate_plan_id, (r.night + 7), r.price_rappen, r.min_stay_arrival, r.max_stay, r.closed_to_arrival, r.closed_to_departure, r.stop_sell
        FROM rates_days r
       WHERE r.hotel_id = ${h.id} AND r.night >= ${addDays(end, -14)}::date AND r.night + 7 < ${end}::date
      ON CONFLICT DO NOTHING`);
  }
}

// ---------------------------------------------------------------- Admin-Kalender (SPEC 9)

export type RateChange = {
  priceRappen?: number;
  minStayArrival?: number;
  maxStay?: number | null;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  stopSell?: boolean;
};

function filterDays(from: string, to: string, weekdays?: number[]): string[] {
  const days = nightsOf(from, addDays(to, 1));
  return weekdays && weekdays.length ? days.filter((d) => weekdays.includes(weekday(d))) : days;
}

/** Zusammenhängende Bereiche bilden (für Outbox-Einträge) */
function toRanges(days: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (const d of days) {
    const last = out[out.length - 1];
    if (last && addDays(last[1], 1) === d) last[1] = d;
    else out.push([d, d]);
  }
  return out;
}

/** Preise/Regeln für einen Rateplan und Zeitraum (inkl. to) setzen. Transaktion + Outbox + Audit. */
export async function updateRates(
  hotelId: string,
  ratePlanId: string,
  from: string,
  to: string,
  change: RateChange,
  opts: { weekdays?: number[]; actor: string },
): Promise<number> {
  return updateRatesBatch(hotelId, [{ ratePlanId, from, to, change }], opts);
}

/** Welche Channex-Felder eine Änderung betrifft (nur diese werden gesendet) */
function changedFields(c: RateChange): RestrictionField[] {
  const f: RestrictionField[] = [];
  if (c.priceRappen !== undefined) f.push("rate");
  if (c.minStayArrival !== undefined) f.push("min_stay_arrival");
  if (c.maxStay !== undefined) f.push("max_stay");
  if (c.closedToArrival !== undefined) f.push("closed_to_arrival");
  if (c.closedToDeparture !== undefined) f.push("closed_to_departure");
  if (c.stopSell !== undefined) f.push("stop_sell");
  return f;
}

export type RateRow = { ratePlanId: string; from: string; to: string; change: RateChange };

/**
 * Mehrere Änderungen (verschiedene Ratepläne/Zeiträume) in EINER Transaktion speichern.
 * Die Outbox-Einträge werden damit gemeinsam sichtbar und gehen als ein einziger Channex-Request raus.
 */
export async function updateRatesBatch(hotelId: string, rowsIn: RateRow[], opts: { weekdays?: number[]; actor: string }): Promise<number> {
  for (const r of rowsIn) {
    if (r.change.priceRappen !== undefined && (!Number.isSafeInteger(r.change.priceRappen) || r.change.priceRappen <= 0)) {
      throw new Error("Preis muss > 0 Rappen sein");
    }
  }
  const work = rowsIn.map((r) => ({ ...r, days: filterDays(r.from, r.to, opts.weekdays) })).filter((r) => r.days.length && Object.keys(r.change).length);
  if (!work.length) return 0;
  return db().transaction(async (tx) => {
    let n = 0;
    for (const { ratePlanId, from, to, change, days } of work) {
      const [plan] = await tx.select().from(ratePlans).where(and(eq(ratePlans.id, ratePlanId), eq(ratePlans.hotelId, hotelId)));
      if (!plan) throw new Error("Rateplan nicht gefunden");
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (change.priceRappen !== undefined) set.priceRappen = change.priceRappen;
      if (change.minStayArrival !== undefined) set.minStayArrival = change.minStayArrival;
      if (change.maxStay !== undefined) set.maxStay = change.maxStay;
      if (change.closedToArrival !== undefined) set.closedToArrival = change.closedToArrival;
      if (change.closedToDeparture !== undefined) set.closedToDeparture = change.closedToDeparture;
      if (change.stopSell !== undefined) set.stopSell = change.stopSell;
      for (const [a, b] of toRanges(days)) {
        const res = await tx
          .update(ratesDays)
          .set(set)
          .where(and(eq(ratesDays.hotelId, hotelId), eq(ratesDays.ratePlanId, ratePlanId), sql`${ratesDays.night} BETWEEN ${a}::date AND ${b}::date`))
          .returning({ night: ratesDays.night });
        // Fehlende Tage neu anlegen, wenn ein Preis gesetzt wird
        const inserting = change.priceRappen !== undefined && res.length < nightsOf(a, addDays(b, 1)).length;
        if (inserting) {
          await tx.execute(sql`
            INSERT INTO rates_days (hotel_id, rate_plan_id, night, price_rappen, min_stay_arrival, max_stay, closed_to_arrival, closed_to_departure, stop_sell)
            SELECT ${hotelId}, ${ratePlanId}, d::date, ${change.priceRappen}, ${change.minStayArrival ?? 1}, ${change.maxStay ?? null},
                   ${change.closedToArrival ?? false}, ${change.closedToDeparture ?? false}, ${change.stopSell ?? false}
              FROM generate_series(${a}::date, ${b}::date, interval '1 day') d
            ON CONFLICT DO NOTHING`);
        }
        n += res.length;
        // Neu angelegte Tage waren vorher nicht buchbar → alle Felder senden
        await enqueueRestrictions(tx, hotelId, ratePlanId, a, b, inserting ? undefined : changedFields(change));
      }
      await audit(tx, { hotelId, actor: opts.actor, action: "rates.update", entity: "rate_plan", entityId: ratePlanId, details: { from, to, weekdays: opts.weekdays ?? null, change } });
    }
    return n;
  });
}

/** Zimmer sperren/freigeben: blocked absolut setzen (0 = freigeben). */
// ASSUMPTION: blocked wird auf total begrenzt; bereits gebuchte Zimmer bleiben gebucht (keine Überbuchung durch Sperre verhindert).
export async function setBlocked(
  hotelId: string,
  roomTypeId: string,
  from: string,
  to: string,
  blocked: number,
  opts: { weekdays?: number[]; actor: string },
): Promise<number> {
  if (!Number.isSafeInteger(blocked) || blocked < 0) throw new Error("Anzahl gesperrter Zimmer ungültig");
  const days = filterDays(from, to, opts.weekdays);
  if (!days.length) return 0;
  return db().transaction(async (tx) => {
    const [rt] = await tx.select().from(roomTypes).where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.hotelId, hotelId)));
    if (!rt) throw new Error("Zimmertyp nicht gefunden");
    let n = 0;
    for (const [a, b] of toRanges(days)) {
      const res = await tx
        .update(inventoryDays)
        .set({ blocked: sql`LEAST(${blocked}, ${inventoryDays.total})`, updatedAt: new Date() })
        .where(and(eq(inventoryDays.hotelId, hotelId), eq(inventoryDays.roomTypeId, roomTypeId), sql`${inventoryDays.night} BETWEEN ${a}::date AND ${b}::date`))
        .returning({ night: inventoryDays.night });
      n += res.length;
      await enqueueAvailability(tx, hotelId, roomTypeId, a, b);
    }
    await audit(tx, { hotelId, actor: opts.actor, action: "inventory.block", entity: "room_type", entityId: roomTypeId, details: { from, to, blocked, weekdays: opts.weekdays ?? null } });
    return n;
  });
}

/** Kalenderdaten für das Admin-Raster */
export async function calendarData(hotelId: string, from: string, days: number) {
  const to = addDays(from, days - 1);
  const rts = await db().select().from(roomTypes).where(eq(roomTypes.hotelId, hotelId)).orderBy(roomTypes.sortOrder);
  const rps = await db().select().from(ratePlans).where(eq(ratePlans.hotelId, hotelId)).orderBy(ratePlans.createdAt);
  const inv = await db()
    .select()
    .from(inventoryDays)
    .where(and(eq(inventoryDays.hotelId, hotelId), sql`${inventoryDays.night} BETWEEN ${from}::date AND ${to}::date`));
  const rates = await db()
    .select()
    .from(ratesDays)
    .where(and(eq(ratesDays.hotelId, hotelId), sql`${ratesDays.night} BETWEEN ${from}::date AND ${to}::date`));
  return { roomTypes: rts, ratePlans: rps, inventory: inv, rates, from, to };
}
