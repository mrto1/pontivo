import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { bookings, guests, roomTypes, type Hotel } from "../db/schema";
import { addDays, todayIn } from "../domain/dates";
import { dayNotices, type DayNotice } from "../domain/day-notices";
import { channexStatus } from "../integrations/channex/connect";
import { dayLists, type DayRow } from "./frontdesk";
import { openGuestRequestCount } from "./guest-requests";
import { newInquiryCount } from "./inquiries";
import { listOpenInvoices, type OpenInvoice } from "./debtors";

/**
 * Startseite «Tag»: Anreisen, Abreisen und Gäste im Haus für einen wählbaren Tag (Vorschau).
 * Hinweise und offene Zahlungen gehören zum Hier und Jetzt und gibt es nur für heute. Zahlen mit Zeitraum stehen in Finanzen → Statistik.
 */
export type OpenBalance = { bookingId: string; reference: string; guest: string; checkin: string; amountRappen: number };
export type TodayView = {
  today: string;
  /** angezeigter Tag */
  day: string;
  notices: DayNotice[];
  arrivals: DayRow[];
  departures: DayRow[];
  inHouse: DayRow[];
  balances: OpenBalance[] | null;
  overdue: OpenInvoice[] | null;
};

export async function todayView(hotel: Hotel, o: { day?: string; manages: boolean; inquiries: boolean; invoicing: boolean; inboxVisible: boolean }): Promise<TodayView> {
  const today = todayIn(hotel.timezone);
  const day = o.day ?? today;
  const lists = await dayLists(hotel.id, day);
  if (day !== today) return { today, day, notices: [], ...lists, balances: null, overdue: null };
  const base = `/mypontivo/${hotel.id}`;
  const failed = o.manages && hotel.channexEnabled ? (await channexStatus(hotel.id)).failed : 0;
  const noPhoto = o.manages
    ? (await db().select({ id: roomTypes.id, name: roomTypes.name, photos: roomTypes.photos }).from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sortOrder))).filter((r) => !r.photos.length).map((r) => ({ id: r.id, name: r.name }))
    : [];
  const notices = dayNotices({
    base, manages: o.manages, channexEnabled: hotel.channexEnabled, channexFailed: failed, roomTypesWithoutPhoto: noPhoto,
    openGuestRequests: o.inboxVisible ? await openGuestRequestCount(hotel.id) : 0,
    openInquiries: o.inboxVisible && o.inquiries ? await newInquiryCount(hotel.id) : 0,
    inboxVisible: o.inboxVisible,
  });
  // Offene Restzahlungen für Aufenthalte, die bald beginnen oder laufen
  const balances = o.invoicing
    ? (await db().select({ id: bookings.id, reference: bookings.reference, checkin: bookings.checkin, amount: bookings.balanceRappen, first: guests.firstName, last: guests.lastName })
      .from(bookings).leftJoin(guests, eq(guests.id, bookings.guestId))
      .where(and(eq(bookings.hotelId, hotel.id), eq(bookings.status, "confirmed"), sql`${bookings.balanceRappen} > 0`, isNull(bookings.balancePaidAt), isNull(bookings.balanceOnsiteAt), lte(bookings.checkin, addDays(today, 7)), sql`${bookings.checkout} >= ${today}`))
      .orderBy(asc(bookings.checkin)).limit(10)).map((b) => ({ bookingId: b.id, reference: b.reference, guest: [b.first, b.last].filter(Boolean).join(" ") || b.reference, checkin: b.checkin, amountRappen: b.amount }))
    : null;
  const overdue = o.invoicing ? (await listOpenInvoices(hotel)).filter((i) => i.daysOverdue > 0).slice(0, 10) : null;
  return { today, day, notices, ...lists, balances, overdue };
}
