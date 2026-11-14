import { and, asc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { db, rows, type Executor } from "../db/client";
import { bookingRooms, bookings, guests, roomTypes, rooms, type Room } from "../db/schema";
import { addDays, diffDays } from "../domain/dates";
import { audit } from "./audit";

/**
 * Rezeption (SPEC 16.2): Zimmernummern, Zuweisung, Zimmerplan, Tagesliste.
 * Die Verfügbarkeit (Zähler pro Zimmertyp, Channex, iCal) bleibt unberührt; die Zuweisung ist eine zweite Schicht.
 */

export class FrontdeskError extends Error {}

const ACTIVE = ["hold", "confirmed"] as const;

// ---------------------------------------------------------------- Zimmer verwalten

export async function listRooms(hotelId: string): Promise<(Room & { typeName: string })[]> {
  const r = await db().select({ room: rooms, typeName: roomTypes.name }).from(rooms)
    .innerJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId))
    .where(eq(rooms.hotelId, hotelId)).orderBy(asc(roomTypes.sortOrder), asc(roomTypes.name), asc(rooms.sortOrder), asc(rooms.number));
  return r.map((x) => ({ ...x.room, typeName: x.typeName }));
}

export async function createRoom(hotelId: string, input: { roomTypeId: string; number: string; floor?: string; note?: string }, actor: string): Promise<Room> {
  const number = input.number.trim();
  if (!number || number.length > 20) throw new FrontdeskError("Bitte eine Zimmernummer (höchstens 20 Zeichen) angeben.");
  const [rt] = await db().select().from(roomTypes).where(and(eq(roomTypes.id, input.roomTypeId), eq(roomTypes.hotelId, hotelId)));
  if (!rt) throw new FrontdeskError("Zimmertyp nicht gefunden.");
  const [dup] = await db().select({ id: rooms.id }).from(rooms).where(and(eq(rooms.hotelId, hotelId), eq(rooms.number, number)));
  if (dup) throw new FrontdeskError(`Die Nummer «${number}» gibt es schon.`);
  return db().transaction(async (tx) => {
    const [max] = rows<{ m: number }>(await tx.execute(sql`SELECT coalesce(max(sort_order),0)::int AS m FROM rooms WHERE hotel_id = ${hotelId}`));
    const [room] = await tx.insert(rooms).values({ hotelId, roomTypeId: rt.id, number, floor: (input.floor ?? "").trim().slice(0, 40), note: (input.note ?? "").trim().slice(0, 200), sortOrder: max.m + 1 }).returning();
    await audit(tx, { hotelId, actor, action: "room.create", entity: "room", entityId: room.id, details: { number, roomTypeId: rt.id } });
    return room;
  });
}

/** Legt für einen Zimmertyp so viele Zimmer an, wie `room_count` vorgibt (Nummern 1, 2, 3 … – bestehende Nummern werden übersprungen) */
export async function seedRooms(hotelId: string, roomTypeId: string, actor: string): Promise<number> {
  const [rt] = await db().select().from(roomTypes).where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.hotelId, hotelId)));
  if (!rt) throw new FrontdeskError("Zimmertyp nicht gefunden.");
  const have = (await db().select().from(rooms).where(and(eq(rooms.hotelId, hotelId), eq(rooms.roomTypeId, roomTypeId)))).length;
  const used = new Set((await db().select({ n: rooms.number }).from(rooms).where(eq(rooms.hotelId, hotelId))).map((r) => r.n));
  let made = 0, n = 1;
  while (have + made < rt.roomCount) {
    // ASSUMPTION: Wenn schon Zimmer mit Nummern existieren, werden freie Nummern ab 1 verwendet; das Hotel kann sie umbenennen (löschen und neu anlegen).
    while (used.has(String(n))) n++;
    await createRoom(hotelId, { roomTypeId, number: String(n) }, actor);
    used.add(String(n));
    made++;
  }
  return made;
}

export async function setRoomActive(hotelId: string, roomId: string, active: boolean, actor: string) {
  await db().update(rooms).set({ active }).where(and(eq(rooms.id, roomId), eq(rooms.hotelId, hotelId)));
  await audit(db(), { hotelId, actor, action: active ? "room.on" : "room.off", entity: "room", entityId: roomId, details: {} });
}

export async function deleteRoom(hotelId: string, roomId: string, actor: string) {
  const [used] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM booking_rooms WHERE hotel_id = ${hotelId} AND room_id = ${roomId}`));
  if (used.n > 0) throw new FrontdeskError("Dieses Zimmer hat Buchungen und kann nicht gelöscht werden. Sperren Sie es stattdessen.");
  await db().delete(rooms).where(and(eq(rooms.id, roomId), eq(rooms.hotelId, hotelId)));
  await audit(db(), { hotelId, actor, action: "room.delete", entity: "room", entityId: roomId, details: {} });
}

// ---------------------------------------------------------------- Zuweisung

/** Hat das Zimmer in diesem Zeitraum schon eine andere Buchung (hold/confirmed)? */
async function roomBusy(ex: Executor, hotelId: string, roomId: string, checkin: string, checkout: string, exceptBookingRoomId?: string): Promise<boolean> {
  const conds = [eq(bookingRooms.hotelId, hotelId), eq(bookingRooms.roomId, roomId), inArray(bookings.status, [...ACTIVE]), lt(bookings.checkin, checkout), gt(bookings.checkout, checkin)];
  if (exceptBookingRoomId) conds.push(ne(bookingRooms.id, exceptBookingRoomId));
  const r = await ex.select({ id: bookingRooms.id }).from(bookingRooms).innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId)).where(and(...conds)).limit(1);
  return r.length > 0;
}

/** Zimmer einer Buchung zuweisen (roomId = null hebt die Zuweisung auf). Nur Zimmer desselben Typs, aktiv, in diesen Nächten frei. */
export async function assignRoom(hotelId: string, bookingRoomId: string, roomId: string | null, actor: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [br] = await tx.select({ br: bookingRooms, checkin: bookings.checkin, checkout: bookings.checkout, status: bookings.status }).from(bookingRooms)
      .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId)).where(and(eq(bookingRooms.id, bookingRoomId), eq(bookingRooms.hotelId, hotelId)));
    if (!br) throw new FrontdeskError("Buchung nicht gefunden.");
    if (roomId) {
      // Zimmerzeile sperren, damit zwei gleichzeitige Zuweisungen nicht dasselbe Zimmer belegen
      const [room] = await tx.select().from(rooms).where(and(eq(rooms.id, roomId), eq(rooms.hotelId, hotelId))).for("update");
      if (!room || !room.active) throw new FrontdeskError("Zimmer nicht verfügbar.");
      if (room.roomTypeId !== br.br.roomTypeId) throw new FrontdeskError("Das Zimmer gehört zu einem anderen Zimmertyp als die Buchung.");
      if (await roomBusy(tx, hotelId, roomId, br.checkin, br.checkout, bookingRoomId)) throw new FrontdeskError("Das Zimmer ist in diesen Nächten schon vergeben.");
    }
    await tx.update(bookingRooms).set({ roomId }).where(eq(bookingRooms.id, bookingRoomId));
    await audit(tx, { hotelId, actor, action: roomId ? "room.assign" : "room.unassign", entity: "booking", entityId: br.br.bookingId, details: { bookingRoomId, roomId } });
  });
}

/**
 * Nicht zugewiesene bestätigte Buchungen der nächsten `days` Tage automatisch verteilen: pro Buchung das freie Zimmer,
 * dessen vorherige Abreise am nächsten liegt (wenig Leerlauf), bei Gleichstand die kleinste Sortierung. Bestehende Zuweisungen bleiben.
 */
export async function autoAssign(hotelId: string, today: string, actor: string, days = 14): Promise<{ assigned: number; left: number }> {
  const todo = await db().select({ id: bookingRooms.id, roomTypeId: bookingRooms.roomTypeId, checkin: bookings.checkin, checkout: bookings.checkout }).from(bookingRooms)
    .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
    .where(and(eq(bookingRooms.hotelId, hotelId), sql`${bookingRooms.roomId} IS NULL`, eq(bookings.status, "confirmed"), sql`${bookings.checkout} > ${today}`, sql`${bookings.checkin} <= ${addDays(today, days)}`))
    .orderBy(asc(bookings.checkin), asc(bookings.createdAt));
  let assigned = 0;
  for (const t of todo) {
    const cands = await db().select().from(rooms).where(and(eq(rooms.hotelId, hotelId), eq(rooms.roomTypeId, t.roomTypeId), eq(rooms.active, true))).orderBy(asc(rooms.sortOrder), asc(rooms.number));
    let best: { id: string; gap: number } | null = null;
    for (const c of cands) {
      if (await roomBusy(db(), hotelId, c.id, t.checkin, t.checkout)) continue;
      const [prev] = rows<{ d: string | null }>(await db().execute(sql`
        SELECT max(b.checkout)::text AS d FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
         WHERE br.hotel_id = ${hotelId} AND br.room_id = ${c.id} AND b.status IN ('hold','confirmed') AND b.checkout <= ${t.checkin}`));
      const gap = prev?.d ? diffDays(prev.d, t.checkin) : 10_000;
      if (!best || gap < best.gap) best = { id: c.id, gap };
    }
    if (!best) continue;
    try {
      await assignRoom(hotelId, t.id, best.id, actor);
      assigned++;
    } catch (e) {
      if (!(e instanceof FrontdeskError)) throw e; // zwischenzeitlich vergeben: nächste Buchung
    }
  }
  return { assigned, left: todo.length - assigned };
}

// ---------------------------------------------------------------- Zimmerplan und Tagesliste

export type PlanBooking = {
  bookingRoomId: string; bookingId: string; reference: string; status: string; checkin: string; checkout: string;
  roomId: string | null; roomTypeId: string; guest: string; persons: number; source: string;
};

/** Belegungen im Zeitraum [from, from+days) */
export async function planBookings(hotelId: string, from: string, days: number): Promise<PlanBooking[]> {
  const to = addDays(from, days);
  const r = await db().select({
    bookingRoomId: bookingRooms.id, bookingId: bookings.id, reference: bookings.reference, status: bookings.status, checkin: bookings.checkin, checkout: bookings.checkout,
    roomId: bookingRooms.roomId, roomTypeId: bookingRooms.roomTypeId, first: guests.firstName, last: guests.lastName, adults: bookingRooms.adults, children: bookingRooms.children, source: bookings.source,
  }).from(bookingRooms).innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId)).leftJoin(guests, eq(guests.id, bookings.guestId))
    .where(and(eq(bookingRooms.hotelId, hotelId), inArray(bookings.status, [...ACTIVE]), lt(bookings.checkin, to), gt(bookings.checkout, from)))
    .orderBy(asc(bookings.checkin));
  return r.map((x) => ({ bookingRoomId: x.bookingRoomId, bookingId: x.bookingId, reference: x.reference, status: x.status, checkin: x.checkin, checkout: x.checkout, roomId: x.roomId, roomTypeId: x.roomTypeId, guest: [x.first, x.last].filter(Boolean).join(" ") || x.reference, persons: x.adults + x.children, source: x.source }));
}

export type DayRow = { bookingId: string; reference: string; guest: string; persons: number; checkin: string; checkout: string; rooms: string[]; typeNames: string[]; status: string };

/** Anreisen, Abreisen, im Haus für einen Tag (nur bestätigte Buchungen) */
export async function dayLists(hotelId: string, day: string): Promise<{ arrivals: DayRow[]; departures: DayRow[]; inHouse: DayRow[] }> {
  const r = await db().select({
    bookingId: bookings.id, reference: bookings.reference, status: bookings.status, checkin: bookings.checkin, checkout: bookings.checkout, first: guests.firstName, last: guests.lastName,
    adults: bookings.adults, children: bookings.children, room: rooms.number, typeName: roomTypes.name,
  }).from(bookings).leftJoin(guests, eq(guests.id, bookings.guestId))
    .innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id)).innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId)).leftJoin(rooms, eq(rooms.id, bookingRooms.roomId))
    .where(and(eq(bookings.hotelId, hotelId), eq(bookings.status, "confirmed"), sql`${bookings.checkin} <= ${day}`, sql`${bookings.checkout} >= ${day}`))
    .orderBy(asc(guests.lastName));
  const map = new Map<string, DayRow>();
  for (const x of r) {
    const cur = map.get(x.bookingId) ?? { bookingId: x.bookingId, reference: x.reference, guest: [x.first, x.last].filter(Boolean).join(" ") || x.reference, persons: x.adults + x.children, checkin: x.checkin, checkout: x.checkout, rooms: [], typeNames: [], status: x.status };
    if (x.room) cur.rooms.push(x.room);
    if (!cur.typeNames.includes(x.typeName)) cur.typeNames.push(x.typeName);
    map.set(x.bookingId, cur);
  }
  const all = [...map.values()];
  return {
    arrivals: all.filter((b) => b.checkin === day),
    departures: all.filter((b) => b.checkout === day),
    inHouse: all.filter((b) => b.checkin < day && b.checkout > day),
  };
}
