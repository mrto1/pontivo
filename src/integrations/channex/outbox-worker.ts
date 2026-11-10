import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { channexOutbox, hotels, inventoryDays, ratePlans, ratesDays, roomTypes, type Hotel } from "../../db/schema";
import { addDays, nightsOf, todayIn, weekday } from "../../domain/dates";
import { rappenToDecimal } from "../../domain/money";
import { occupancyPrices } from "../../domain/pricing";
import { audit } from "../../services/audit";
import { enqueueAvailability, enqueueRestrictions } from "../../services/outbox";
import { HORIZON_DAYS } from "../../services/inventory";
import { channex, ChannexHttpError, type AvailabilityValue, type RestrictionValue } from "./client";
import { channexAlert } from "./alerts";

/** Channex: 10 Availability- und 10 Restrictions-Requests pro Minute und Property (Rate-Limits-Doku). */
export const MAX_REQUESTS_PER_MINUTE = 10;
/** ASSUMPTION: Nicht weiter als 500 Tage senden (Channex-Standard `state_length` = 500). */
export const CHANNEX_STATE_DAYS = 500;
const ALERT_AFTER_MS = 15 * 60_000;

type Kind = "availability" | "restrictions";

/** Zustand pro Worker-Prozess (Rate-Limit-Fenster, Pausen, Alarme) */
export class OutboxState {
  sent = new Map<string, number[]>(); // key hotel|kind → Zeitstempel der Requests
  pausedUntil = new Map<string, number>();
  failingSince = new Map<string, number>();
  alerted = new Set<string>();

  /** Gleitendes 60-s-Fenster: höchstens MAX_REQUESTS_PER_MINUTE */
  canSend(key: string, now: number): boolean {
    const list = (this.sent.get(key) ?? []).filter((t) => now - t < 60_000);
    this.sent.set(key, list);
    return list.length < MAX_REQUESTS_PER_MINUTE;
  }
  record(key: string, now: number) {
    this.sent.get(key)!.push(now);
  }
}

export function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000);
}

/** Überlappende/angrenzende Bereiche vereinigen */
export function mergeRanges(ranges: [string, string][]): [string, string][] {
  const sorted = [...ranges].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const out: [string, string][] = [];
  for (const [f, t] of sorted) {
    const last = out[out.length - 1];
    if (last && f <= addDays(last[1], 1)) {
      if (t > last[1]) last[1] = t;
    } else out.push([f, t]);
  }
  return out;
}

/** Tage mit gleichem Wert zu Bereichen zusammenfassen */
export function runs<V>(days: string[], valueOf: (d: string) => V, same: (a: V, b: V) => boolean) {
  const out: { from: string; to: string; value: V }[] = [];
  for (const d of days) {
    const v = valueOf(d);
    const last = out[out.length - 1];
    if (last && addDays(last.to, 1) === d && same(last.value, v)) last.to = d;
    else out.push({ from: d, to: d, value: v });
  }
  return out;
}

function clamp(ranges: [string, string][], today: string): [string, string][] {
  const max = addDays(today, CHANNEX_STATE_DAYS - 1);
  return ranges
    .map(([f, t]) => [f < today ? today : f, t > max ? max : t] as [string, string])
    .filter(([f, t]) => f <= t);
}

type Entry = typeof channexOutbox.$inferSelect;

async function buildAvailability(hotel: Hotel, entries: Entry[], today: string): Promise<AvailabilityValue[]> {
  const byRt = new Map<string, [string, string][]>();
  for (const e of entries) if (e.roomTypeId) byRt.set(e.roomTypeId, [...(byRt.get(e.roomTypeId) ?? []), [e.dateFrom, e.dateTo]]);
  if (!byRt.size) return [];
  const rts = await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), inArray(roomTypes.id, [...byRt.keys()])));
  const values: AvailabilityValue[] = [];
  for (const rt of rts) {
    if (!rt.channexRoomTypeId) continue; // nicht gemappt → nichts senden
    for (const [f, t] of clamp(mergeRanges(byRt.get(rt.id)!), today)) {
      // Aktuelle Werte aus der DB lesen (nicht die zum Zeitpunkt der Änderung), SPEC 7.2
      const rows = await db()
        .select()
        .from(inventoryDays)
        .where(and(eq(inventoryDays.roomTypeId, rt.id), sql`${inventoryDays.night} BETWEEN ${f}::date AND ${t}::date`));
      const by = new Map(rows.map((r) => [r.night, rt.active ? Math.max(0, r.total - r.booked - r.blocked) : 0]));
      for (const r of runs(nightsOf(f, addDays(t, 1)), (d) => by.get(d) ?? 0, (a, b) => a === b)) {
        values.push({ property_id: hotel.channexPropertyId!, room_type_id: rt.channexRoomTypeId, date_from: r.from, date_to: r.to, availability: r.value });
      }
    }
  }
  return values;
}

type R = { rate: string | null; rates: { occupancy: number; rate: string }[] | null; min: number; max: number; cta: boolean; ctd: boolean; ss: boolean };

async function buildRestrictions(hotel: Hotel, entries: Entry[], today: string): Promise<RestrictionValue[]> {
  const byRp = new Map<string, [string, string][]>();
  for (const e of entries) if (e.ratePlanId) byRp.set(e.ratePlanId, [...(byRp.get(e.ratePlanId) ?? []), [e.dateFrom, e.dateTo]]);
  if (!byRp.size) return [];
  const rps = await db().select().from(ratePlans).where(and(eq(ratePlans.hotelId, hotel.id), inArray(ratePlans.id, [...byRp.keys()])));
  const maxAdults = new Map(
    (await db().select({ id: roomTypes.id, maxAdults: roomTypes.maxAdults }).from(roomTypes).where(eq(roomTypes.hotelId, hotel.id))).map((r) => [r.id, r.maxAdults]),
  );
  const values: RestrictionValue[] = [];
  for (const rp of rps) {
    if (!rp.channexRatePlanId) continue;
    const perPerson = rp.channexPerPerson;
    const occupancies = maxAdults.get(rp.roomTypeId) ?? rp.baseOccupancy;
    for (const [f, t] of clamp(mergeRanges(byRp.get(rp.id)!), today)) {
      const rows = await db()
        .select()
        .from(ratesDays)
        .where(and(eq(ratesDays.ratePlanId, rp.id), sql`${ratesDays.night} BETWEEN ${f}::date AND ${t}::date`));
      const by = new Map(rows.map((r) => [r.night, r]));
      const valueOf = (d: string): R => {
        const r = by.get(d);
        // ASSUMPTION: Fehlende Zeile = nicht buchbar → nur stop_sell senden. max_stay NULL → 0 (keine Begrenzung).
        if (!r) return { rate: null, rates: null, min: 1, max: 0, cta: false, ctd: false, ss: true };
        return {
          rate: rappenToDecimal(r.priceRappen),
          rates: perPerson
            ? occupancyPrices(r.priceRappen, rp, occupancies).map((o) => ({ occupancy: o.occupancy, rate: rappenToDecimal(o.price_rappen) }))
            : null,
          min: Math.max(r.minStayArrival, rp.minNights),
          max: r.maxStay ?? 0,
          cta: r.closedToArrival || (rp.arrivalWeekdays.length > 0 && !rp.arrivalWeekdays.includes(weekday(d))),
          ctd: r.closedToDeparture,
          ss: r.stopSell || !rp.active,
        };
      };
      const same = (a: R, b: R) =>
        a.rate === b.rate && JSON.stringify(a.rates) === JSON.stringify(b.rates) && a.min === b.min && a.max === b.max && a.cta === b.cta && a.ctd === b.ctd && a.ss === b.ss;
      for (const r of runs(nightsOf(f, addDays(t, 1)), valueOf, same)) {
        const v = r.value;
        values.push(
          v.rate === null
            ? { property_id: hotel.channexPropertyId!, rate_plan_id: rp.channexRatePlanId, date_from: r.from, date_to: r.to, stop_sell: true }
            : {
                property_id: hotel.channexPropertyId!,
                rate_plan_id: rp.channexRatePlanId,
                date_from: r.from,
                date_to: r.to,
                ...(v.rates ? { rates: v.rates } : { rate: v.rate }),
                min_stay_arrival: v.min,
                max_stay: v.max,
                closed_to_arrival: v.cta,
                closed_to_departure: v.ctd,
                stop_sell: v.ss,
              },
        );
      }
    }
  }
  return values;
}

/**
 * Ein Durchlauf des Workers `channex-outbox` (alle 6 Sekunden, SPEC 7.2).
 * Pro Hotel und Art höchstens ein Request pro Durchlauf.
 */
export async function runOutboxOnce(state: OutboxState, now: Date = new Date()): Promise<{ requests: number }> {
  const t = now.getTime();
  // Einträge von Hotels ohne Channex nicht ewig liegen lassen (beim Verbinden gibt es einen Vollabgleich)
  await db().execute(sql`
    UPDATE channex_outbox SET status = 'sent', sent_at = now(), last_error = 'übersprungen: Channex nicht aktiv'
     WHERE status = 'pending' AND hotel_id IN (SELECT id FROM hotels WHERE NOT channex_enabled OR channex_property_id IS NULL)`);

  // Hängengebliebene Einträge (Worker abgestürzt) nach 5 Minuten wieder freigeben
  await db().execute(sql`
    UPDATE channex_outbox SET status = 'pending'
     WHERE status = 'sending' AND next_attempt_at < ${new Date(t - 5 * 60_000)}`);

  const due = await db()
    .selectDistinct({ hotelId: channexOutbox.hotelId, kind: channexOutbox.kind })
    .from(channexOutbox)
    .where(and(eq(channexOutbox.status, "pending"), lte(channexOutbox.nextAttemptAt, now)));
  let requests = 0;
  for (const { hotelId, kind } of due) {
    const key = `${hotelId}|${kind}`;
    if ((state.pausedUntil.get(key) ?? 0) > t) continue;
    if (!state.canSend(key, t)) continue;
    const [hotel] = await db().select().from(hotels).where(eq(hotels.id, hotelId));
    if (!hotel?.channexEnabled || !hotel.channexPropertyId) continue;

    const claimed = await db()
      .update(channexOutbox)
      .set({ status: "sending", attempts: sql`${channexOutbox.attempts} + 1`, nextAttemptAt: now })
      .where(and(eq(channexOutbox.hotelId, hotelId), eq(channexOutbox.kind, kind), eq(channexOutbox.status, "pending"), lte(channexOutbox.nextAttemptAt, now)))
      .returning();
    if (!claimed.length) continue;
    const ids = claimed.map((c) => c.id);
    const today = todayIn(hotel.timezone, now);

    try {
      const values = kind === "availability" ? await buildAvailability(hotel, claimed, today) : await buildRestrictions(hotel, claimed, today);
      if (values.length) {
        state.record(key, t);
        requests++;
        const res =
          kind === "availability"
            ? await channex.postAvailability(values as AvailabilityValue[])
            : await channex.postRestrictions(values as RestrictionValue[]);
        const warnings = res?.meta?.warnings ?? [];
        if (warnings.length) {
          // Validierungsfehler kommen als 200 mit meta.warnings (ARI-Doku) → failed + Alarm
          await db().update(channexOutbox).set({ status: "failed", lastError: JSON.stringify(warnings).slice(0, 4000) }).where(inArray(channexOutbox.id, ids));
          await channexAlert(hotel, `Channex hat ${kind}-Werte abgelehnt`, JSON.stringify(warnings).slice(0, 2000));
          continue;
        }
      }
      await db().update(channexOutbox).set({ status: "sent", sentAt: now, lastError: null }).where(inArray(channexOutbox.id, ids));
      state.failingSince.delete(key);
      state.alerted.delete(key);
    } catch (e) {
      const err = e as Error;
      const retry = e instanceof ChannexHttpError ? e.retryable : false;
      if (retry) {
        const attempts = Math.max(...claimed.map((c) => c.attempts));
        const wait = backoffMs(attempts);
        state.pausedUntil.set(key, t + wait);
        if (!state.failingSince.has(key)) state.failingSince.set(key, t);
        await db()
          .update(channexOutbox)
          .set({ status: "pending", nextAttemptAt: new Date(t + wait), lastError: err.message.slice(0, 4000) })
          .where(inArray(channexOutbox.id, ids));
        if (t - state.failingSince.get(key)! >= ALERT_AFTER_MS && !state.alerted.has(key)) {
          state.alerted.add(key);
          await channexAlert(hotel, "Channex seit über 15 Minuten nicht erreichbar", err.message);
        }
      } else {
        await db().update(channexOutbox).set({ status: "failed", lastError: err.message.slice(0, 4000) }).where(inArray(channexOutbox.id, ids));
        await channexAlert(hotel, `Channex-Fehler (${kind})`, err.message);
      }
    }
  }
  return { requests };
}

/** SPEC 7.1: Vollabgleich – Outbox für alle Zimmertypen und Ratepläne über den ganzen Horizont */
export async function enqueueFullSync(hotel: Hotel, actor: string) {
  const today = todayIn(hotel.timezone);
  const to = addDays(today, Math.min(HORIZON_DAYS, CHANNEX_STATE_DAYS) - 1);
  await db().transaction(async (tx) => {
    const rts = await tx.select().from(roomTypes).where(eq(roomTypes.hotelId, hotel.id));
    for (const rt of rts) if (rt.channexRoomTypeId) await enqueueAvailability(tx, hotel.id, rt.id, today, to);
    const rps = await tx.select().from(ratePlans).where(eq(ratePlans.hotelId, hotel.id));
    for (const rp of rps) if (rp.channexRatePlanId) await enqueueRestrictions(tx, hotel.id, rp.id, today, to);
    await audit(tx, { hotelId: hotel.id, actor, action: "channex.full_sync", entity: "hotel", entityId: hotel.id });
  });
}
