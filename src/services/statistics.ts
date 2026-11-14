import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { bookingRooms, bookings, roomTypes } from "../db/schema";
import { computeStats, type NightRow, type StatsResult } from "../domain/stats";
import { addDays } from "../domain/dates";
import { periodMonths, shiftMonth, type Period } from "./overview";

/** Statistik (SPEC 17.3): nur bestätigte Buchungen, Zimmerumsatz aus den Nachtpreisen (ohne Kurtaxe, Extras, Posten). Jede Abfrage nach hotel_id. */
export async function statistics(hotelId: string, period: Period, today: string): Promise<StatsResult & { from: string; to: string }> {
  const months = periodMonths(period, today);
  const from = `${months[0]}-01`;
  const lastMonthEnd = `${shiftMonth(months[months.length - 1], 1)}-01`;
  // ASSUMPTION: ganze Monate, auch künftige Tage des laufenden Monats (Belegung dann inkl. bereits vorhandener Buchungen)
  const to = lastMonthEnd;
  const types = await db().select({ id: roomTypes.id, name: roomTypes.name, count: roomTypes.roomCount }).from(roomTypes).where(and(eq(roomTypes.hotelId, hotelId), eq(roomTypes.active, true)));
  const rs = await db().select({ source: bookings.source, nights: bookingRooms.nightlyPrices, roomTypeId: bookingRooms.roomTypeId })
    .from(bookingRooms).innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
    .where(and(eq(bookings.hotelId, hotelId), eq(bookings.status, "confirmed"), sql`${bookings.checkin} < ${to}`, sql`${bookings.checkout} > ${from}`));
  const rows: NightRow[] = rs.flatMap((r) => r.nights.map((n) => ({ night: n.night, roomTypeId: r.roomTypeId, source: r.source, priceRappen: n.price_rappen })));
  return { ...computeStats(rows, types, from, to), from, to: addDays(to, -1) };
}
