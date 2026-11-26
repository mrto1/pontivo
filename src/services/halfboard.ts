import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { bookingRooms, bookings, guests, hotels, posReservations, posTables, ratePlans, restaurantSettings, rooms, roomTypes, type Hotel } from "../db/schema";
import { addDays, todayIn } from "../domain/dates";
import { suggestCombination, suggestTable } from "../domain/reservations";
import { audit } from "./audit";
import { getSettings } from "./reservations";

/**
 * Halbpension mit Tisch (SPEC 19.62): Für jede Nacht eines bestätigten Aufenthalts mit Halb- oder Vollpension (Tarif) gibt es eine Reservierung
 * zur Abendessenszeit, Personen = Erwachsene + Kinder der Zimmer. Eindeutig je (Buchung, Tag); der Abgleich legt fehlende an,
 * passt Personen und Zimmer an und storniert Reservierungen, deren Nacht nicht mehr zutrifft (Storno, kürzerer Aufenthalt, anderer Tarif), solange der Gast nicht sitzt.
 */
export type HalfboardStay = { bookingId: string; name: string; phone: string; party: number; rooms: string };

/** Aufenthalte mit Halb-/Vollpension, die in der Nacht `day` im Haus sind (Anreise bis Abreise − 1) */
export async function halfboardStays(hotelId: string, day: string): Promise<HalfboardStay[]> {
  const rs = await db().select({ b: bookings, br: bookingRooms, room: rooms.number, type: roomTypes.name, g: guests })
    .from(bookings).innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
    .innerJoin(ratePlans, eq(ratePlans.id, bookingRooms.ratePlanId))
    .innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
    .leftJoin(rooms, eq(rooms.id, bookingRooms.roomId))
    .leftJoin(guests, eq(guests.id, bookings.guestId))
    .where(and(eq(bookings.hotelId, hotelId), eq(bookings.status, "confirmed"), lte(bookings.checkin, day), sql`${bookings.checkout} > ${day}`, inArray(ratePlans.board, ["half", "full"])));
  const by = new Map<string, HalfboardStay>();
  for (const r of rs) {
    const cur = by.get(r.b.id) ?? { bookingId: r.b.id, name: r.g ? `${r.g.lastName} ${r.g.firstName}`.trim() : r.b.reference, phone: r.g?.phone ?? "", party: 0, rooms: "" };
    cur.party += r.br.adults + r.br.children;
    const room = r.room ? `Zimmer ${r.room}` : r.type;
    cur.rooms = cur.rooms ? `${cur.rooms}, ${room}` : room;
    by.set(r.b.id, cur);
  }
  return [...by.values()].filter((x) => x.party > 0).sort((a, b) => a.name.localeCompare(b.name));
}

/** Abgleich für einen Tag; liefert angelegt / angepasst / storniert */
export async function syncHalfboard(hotel: Hotel, day: string, actor = "job"): Promise<{ created: number; updated: number; cancelled: number }> {
  const s = await getSettings(hotel.id);
  const out = { created: 0, updated: 0, cancelled: 0 };
  if (!s.halfboardEnabled) return out;
  const time = s.halfboardTime ?? "19:00";
  const stays = await halfboardStays(hotel.id, day);
  const existing = await db().select().from(posReservations).where(and(eq(posReservations.hotelId, hotel.id), eq(posReservations.day, day)));
  const tables = await db().select().from(posTables).where(and(eq(posTables.hotelId, hotel.id), eq(posTables.active, true))).orderBy(asc(posTables.sortOrder), asc(posTables.name));
  const mine = new Map(existing.filter((r) => r.bookingId).map((r) => [r.bookingId!, r]));
  const want = new Set(stays.map((x) => x.bookingId));
  for (const st of stays) {
    const note = `Halbpension · ${st.rooms}`;
    const ex = mine.get(st.bookingId);
    if (ex) {
      if (ex.status === "cancelled" || ex.status === "noshow" || ex.status === "seated") continue; // bewusst vom Personal geändert oder schon am Tisch
      if (ex.party !== st.party || ex.note !== note) {
        await db().update(posReservations).set({ party: st.party, note }).where(and(eq(posReservations.id, ex.id), eq(posReservations.hotelId, hotel.id)));
        out.updated++;
      }
      continue;
    }
    const list = await db().select().from(posReservations).where(and(eq(posReservations.hotelId, hotel.id), eq(posReservations.day, day)));
    let tableId = suggestTable(tables, list, st.party, time, s.durationMin);
    let extra: string[] = [];
    if (!tableId && s.combineTables) { const c = suggestCombination(tables, list, st.party, time, s.durationMin); if (c) { tableId = c[0]; extra = c.slice(1); } }
    const [row] = await db().insert(posReservations).values({
      hotelId: hotel.id, day, time, party: st.party, name: st.name, phone: st.phone, email: "", note, tableId, extraTableIds: extra, source: "admin", language: hotel.defaultLanguage,
      publicToken: crypto.randomUUID().replace(/-/g, ""), status: "confirmed", bookingId: st.bookingId,
    }).onConflictDoNothing().returning();
    if (row) {
      out.created++;
      await audit(db(), { hotelId: hotel.id, actor, action: "reservation.halfboard", entity: "pos_reservation", entityId: row.id, details: { bookingId: st.bookingId, day, party: st.party } });
    }
  }
  for (const r of existing) {
    if (!r.bookingId || want.has(r.bookingId) || r.status !== "confirmed") continue;
    await db().update(posReservations).set({ status: "cancelled" }).where(and(eq(posReservations.id, r.id), eq(posReservations.hotelId, hotel.id)));
    await audit(db(), { hotelId: hotel.id, actor, action: "reservation.halfboard_cancel", entity: "pos_reservation", entityId: r.id, details: { bookingId: r.bookingId, day } });
    out.cancelled++;
  }
  return out;
}

/** Job: heute und die nächsten zwei Tage für alle Betriebe mit eingeschalteter Halbpension */
export async function halfboardJob(now = new Date()): Promise<number> {
  const on = await db().select({ id: restaurantSettings.hotelId }).from(restaurantSettings).where(eq(restaurantSettings.halfboardEnabled, true));
  let n = 0;
  for (const x of on) {
    const [h] = await db().select().from(hotels).where(eq(hotels.id, x.id));
    if (!h) continue;
    const today = todayIn(h.timezone, now);
    for (const d of [today, addDays(today, 1), addDays(today, 2)]) { const r = await syncHalfboard(h, d); n += r.created + r.updated + r.cancelled; }
  }
  return n;
}
