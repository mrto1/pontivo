import { and, asc, eq, lte, or, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, rows } from "../db/client";
import { hotels, icalFeedNights, icalFeeds, inventoryDays, roomTypes } from "../db/schema";
import { addDays, todayIn, type Day } from "../domain/dates";
import { buildIcal, nightRanges, parseIcal } from "../domain/ical";
import { checkFeedUrl, safeFetchText } from "../lib/safe-fetch";
import { audit } from "./audit";
import { ensureInventory, HORIZON_DAYS } from "./inventory";
import { enqueueAvailability } from "./outbox";
import { raiseAlert } from "./monitor";

/** iCal-Abgleich (SPEC 7b). Export: ausverkaufte Nächte pro Zimmertyp. Import: fremde Kalender belegen Nächte (external_blocked). */

export const MAX_FEEDS_PER_ROOM = 5;
export const SYNC_EVERY_MS = 14 * 60_000;
const FAIL_ALERT_MS = 48 * 3600_000;

export class IcalError extends Error {}

// ---------------------------------------------------------------- Export

export function exportUrl(base: string, token: string) {
  return `${base}/api/ical/${token}.ics`;
}

/** Inhalt des Export-Feeds, null = Token unbekannt. Importierte Belegungen werden nicht zurückgespiegelt (keine Schleifen). */
export async function exportFeed(token: string, now = new Date()): Promise<string | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const [rt] = await db().select().from(roomTypes).where(eq(roomTypes.icalToken, token));
  if (!rt) return null;
  const [h] = await db().select().from(hotels).where(eq(hotels.id, rt.hotelId));
  const today = todayIn(h.timezone, now);
  const nights = rt.active
    ? (await db()
        .select({ night: inventoryDays.night })
        .from(inventoryDays)
        .where(and(eq(inventoryDays.hotelId, rt.hotelId), eq(inventoryDays.roomTypeId, rt.id), sql`${inventoryDays.night} >= ${today}::date`, sql`${inventoryDays.total} - ${inventoryDays.booked} - ${inventoryDays.blocked} <= 0`))
        .orderBy(asc(inventoryDays.night))).map((r) => r.night)
    : [];
  return buildIcal(`${h.name} – ${rt.name}`, rt.id, nights, now);
}

export async function regenerateToken(hotelId: string, roomTypeId: string, actor: string): Promise<void> {
  await db().transaction(async (tx) => {
    const res = await tx.execute(sql`
      UPDATE room_types SET ical_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
       WHERE id = ${roomTypeId} AND hotel_id = ${hotelId} RETURNING id`);
    if (!res.rows.length) throw new IcalError("Zimmertyp nicht gefunden");
    await audit(tx, { hotelId, actor, action: "ical.token_regenerated", entity: "room_type", entityId: roomTypeId });
  });
}

// ---------------------------------------------------------------- Import

const feedInput = z.object({ name: z.string().trim().min(1, "Name fehlt").max(80), url: z.string().trim().min(8, "Adresse fehlt").max(2000) });

export async function listFeeds(hotelId: string) {
  return db().select().from(icalFeeds).where(eq(icalFeeds.hotelId, hotelId)).orderBy(asc(icalFeeds.createdAt));
}

export async function addFeed(hotelId: string, roomTypeId: string, input: { name: string; url: string }, actor: string) {
  const v = feedInput.parse(input);
  checkFeedUrl(v.url); // wirft bei ungültiger/interner Adresse
  return db().transaction(async (tx) => {
    const [rt] = await tx.select().from(roomTypes).where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.hotelId, hotelId)));
    if (!rt) throw new IcalError("Zimmertyp nicht gefunden");
    const n = rows<{ n: number }>(await tx.execute(sql`SELECT count(*)::int AS n FROM ical_feeds WHERE room_type_id = ${roomTypeId}`))[0].n;
    if (n >= MAX_FEEDS_PER_ROOM) throw new IcalError(`Höchstens ${MAX_FEEDS_PER_ROOM} Kalender pro Zimmer`);
    const [f] = await tx.insert(icalFeeds).values({ hotelId, roomTypeId, name: v.name, url: v.url }).returning();
    // Die Adresse enthält oft einen geheimen Schlüssel → nicht ins Protokoll
    await audit(tx, { hotelId, actor, action: "ical.feed_added", entity: "ical_feed", entityId: f.id, details: { name: v.name, roomTypeId } });
    return f;
  });
}

export async function removeFeed(hotelId: string, feedId: string, actor: string) {
  await db().transaction(async (tx) => {
    const [f] = await tx.select().from(icalFeeds).where(and(eq(icalFeeds.id, feedId), eq(icalFeeds.hotelId, hotelId))).for("update");
    if (!f) throw new IcalError("Kalender nicht gefunden");
    const old = (await tx.select({ night: icalFeedNights.night }).from(icalFeedNights).where(eq(icalFeedNights.feedId, feedId))).map((r) => r.night);
    await tx.delete(icalFeedNights).where(eq(icalFeedNights.feedId, feedId));
    await recompute(tx, hotelId, f.roomTypeId, old);
    await tx.delete(icalFeeds).where(eq(icalFeeds.id, feedId));
    await audit(tx, { hotelId, actor, action: "ical.feed_removed", entity: "ical_feed", entityId: feedId, details: { name: f.name } });
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** external_blocked für die Nächte neu aus ical_feed_nights berechnen (höchstens `total`) und Channex benachrichtigen */
async function recompute(tx: Tx, hotelId: string, roomTypeId: string, nights: Day[]) {
  for (const r of nightRanges(nights)) {
    const to = addDays(r.to, -1);
    await ensureInventory(tx, hotelId, roomTypeId, r.from, r.to);
    await tx.execute(sql`
      UPDATE inventory_days i
         SET external_blocked = LEAST(i.total, (SELECT count(*) FROM ical_feed_nights n WHERE n.room_type_id = i.room_type_id AND n.night = i.night)),
             updated_at = now()
       WHERE i.hotel_id = ${hotelId} AND i.room_type_id = ${roomTypeId} AND i.night BETWEEN ${r.from}::date AND ${to}::date`);
    await enqueueAvailability(tx, hotelId, roomTypeId, r.from, to);
  }
}

export type SyncResult = { ok: boolean; added: number; removed: number; conflicts: number; error?: string };

/** Einen Kalender abholen und abgleichen. Bei Fehler bleibt der bisherige Stand bestehen (nie versehentlich Zimmer freigeben). */
export async function syncFeed(feedId: string, opts: { fetchText?: (url: string) => Promise<string>; now?: Date } = {}): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const [feed] = await db().select().from(icalFeeds).where(eq(icalFeeds.id, feedId));
  if (!feed) throw new IcalError("Kalender nicht gefunden");
  const [h] = await db().select().from(hotels).where(eq(hotels.id, feed.hotelId));
  const today = todayIn(h.timezone, now);
  const fail = async (error: string): Promise<SyncResult> => {
    await db().update(icalFeeds).set({ lastSyncedAt: now, lastError: error }).where(eq(icalFeeds.id, feedId));
    const since = feed.lastOkAt ?? feed.createdAt;
    if (now.getTime() - since.getTime() > FAIL_ALERT_MS) {
      await raiseAlert(`ical:${feedId}`, `iCal-Kalender «${feed.name}» seit über 48 Stunden nicht abrufbar`, `Hotel ${h.name} (${h.id}): ${error}`, now, 24 * 3600_000);
    }
    return { ok: false, added: 0, removed: 0, conflicts: 0, error };
  };
  let parsed;
  try {
    const text = await (opts.fetchText ?? safeFetchText)(feed.url);
    parsed = parseIcal(text, h.timezone, today, addDays(today, HORIZON_DAYS));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Abruf fehlgeschlagen");
  }
  if (!parsed.ok) return fail(parsed.error);
  const next = parsed.nights;

  return db().transaction(async (tx) => {
    await tx.select().from(icalFeeds).where(eq(icalFeeds.id, feedId)).for("update");
    const oldAll = (await tx.select({ night: icalFeedNights.night }).from(icalFeedNights).where(eq(icalFeedNights.feedId, feedId))).map((r) => r.night);
    const old = new Set(oldAll);
    const added = [...next].filter((d) => !old.has(d));
    const removed = oldAll.filter((d) => !next.has(d));
    if (removed.length) await tx.delete(icalFeedNights).where(and(eq(icalFeedNights.feedId, feedId), sql`${icalFeedNights.night} = ANY(${sql.raw(`ARRAY[${removed.map((n) => `'${n}'`).join(",")}]`)}::date[])`));
    if (added.length) await tx.insert(icalFeedNights).values(added.map((night) => ({ feedId, hotelId: feed.hotelId, roomTypeId: feed.roomTypeId, night })));
    await recompute(tx, feed.hotelId, feed.roomTypeId, [...added, ...removed]);
    // Nächte, in denen zusätzlich eine eigene Buchung liegt (Doppelbelegung)
    let conflicts = 0;
    if (next.size) {
      conflicts = rows<{ n: number }>(
        await tx.execute(sql`
          SELECT count(*)::int AS n FROM inventory_days i
           WHERE i.room_type_id = ${feed.roomTypeId} AND i.booked > 0
             AND i.booked + i.blocked + (SELECT count(*) FROM ical_feed_nights n WHERE n.room_type_id = i.room_type_id AND n.night = i.night) > i.total
             AND EXISTS (SELECT 1 FROM ical_feed_nights n WHERE n.feed_id = ${feedId} AND n.night = i.night)`),
      )[0].n;
    }
    await tx.update(icalFeeds).set({ lastSyncedAt: now, lastOkAt: now, lastError: null, lastConflicts: conflicts }).where(eq(icalFeeds.id, feedId));
    if (added.length || removed.length) {
      await audit(tx, { hotelId: feed.hotelId, actor: "system:ical", action: "ical.sync", entity: "ical_feed", entityId: feedId, details: { added: added.length, removed: removed.length, conflicts } });
    }
    return { ok: true, added: added.length, removed: removed.length, conflicts };
  });
}

/** Worker-Job: fällige Kalender abholen (ein fehlerhafter blockiert die anderen nicht) */
export async function syncDueFeeds(now = new Date()) {
  const due = await db()
    .select({ id: icalFeeds.id })
    .from(icalFeeds)
    .where(and(eq(icalFeeds.active, true), or(isNull(icalFeeds.lastSyncedAt), lte(icalFeeds.lastSyncedAt, new Date(now.getTime() - SYNC_EVERY_MS)))));
  let ok = 0;
  let failed = 0;
  for (const f of due) {
    try {
      (await syncFeed(f.id, { now })).ok ? ok++ : failed++;
    } catch (e) {
      failed++;
      console.error("[ical]", f.id, e);
    }
  }
  return { ok, failed };
}
