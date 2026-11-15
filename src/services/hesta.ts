import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { bookingRooms, bookings, guestRegistrations, roomTypes } from "../db/schema";
import { byCountry, monthEnd, occupancy, type StayPerson } from "../domain/hesta";

/**
 * HESTA-Auswertung eines Monats (SPEC 19.8): bestätigte Buchungen. Herkunftsland = Nationalität aus der Gästemeldung (Meldeschein);
 * für Personen ohne Meldung zählen Erwachsene und Kinder der Buchung mit «Land unbekannt». Jede Abfrage nach hotel_id.
 */
export async function hestaMonth(hotelId: string, month: string) {
  const from = `${month}-01`;
  const to = monthEnd(month);
  const bs = await db().select({ id: bookings.id, checkin: bookings.checkin, checkout: bookings.checkout, persons: sql<number>`${bookings.adults} + ${bookings.children}` })
    .from(bookings).where(and(eq(bookings.hotelId, hotelId), eq(bookings.status, "confirmed"), sql`${bookings.checkin} < ${to}`, sql`${bookings.checkout} > ${from}`));
  const regs = bs.length
    ? await db().select({ bookingId: guestRegistrations.bookingId, country: guestRegistrations.nationality, arrival: guestRegistrations.arrivalDate, departure: guestRegistrations.departureDate })
        .from(guestRegistrations).where(and(eq(guestRegistrations.hotelId, hotelId), sql`${guestRegistrations.bookingId} IN (${sql.join(bs.map((b) => sql`${b.id}`), sql`, `)})`))
    : [];
  const people: StayPerson[] = [];
  for (const b of bs) {
    const mine = regs.filter((r) => r.bookingId === b.id);
    for (const r of mine) people.push({ country: r.country?.trim() || null, arrival: r.arrival, departure: r.departure });
    for (let i = mine.length; i < Number(b.persons); i++) people.push({ country: null, arrival: b.checkin, departure: b.checkout });
  }
  const rooms = await db().select({ nights: bookingRooms.nightlyPrices }).from(bookingRooms).innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
    .where(and(eq(bookings.hotelId, hotelId), eq(bookings.status, "confirmed"), sql`${bookings.checkin} < ${to}`, sql`${bookings.checkout} > ${from}`));
  const occupied = rooms.reduce((a, r) => a + r.nights.filter((n) => n.night >= from && n.night < to).length, 0);
  const types = await db().select({ roomCount: roomTypes.roomCount, maxOccupancy: roomTypes.maxOccupancy }).from(roomTypes).where(and(eq(roomTypes.hotelId, hotelId), eq(roomTypes.active, true)));
  const rows = byCountry(people, month);
  return { month, rows, occupancy: occupancy(types, occupied, month), registered: regs.length, unknown: rows.find((r) => r.country === null)?.nights ?? 0 };
}
