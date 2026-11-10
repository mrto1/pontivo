import { z } from "zod";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db, rows, type Tx } from "../db/client";
import { auditLog, bookingExtras, bookingRooms, bookings, extras, guests, hotels, payments, ratePlans, roomTypes, type Booking, type Hotel } from "../db/schema";
import { addDays, isDay, nightsOf, todayIn, zonedToUtc } from "../domain/dates";
import { newPublicToken, newReference } from "../domain/ids";
import { resolveExtras } from "../domain/extras";
import { LOCALES } from "../i18n/dict";
import { enqueueEmail } from "../email/enqueue";
import { audit } from "./audit";
import { enqueueAvailability } from "./outbox";
import { searchOffers } from "./search";
import { BookingError, releaseNights, reserveNights, RollbackSoldOut } from "./bookings";

/** Buchungsliste eines Hotels (immer nach hotel_id gefiltert, SPEC 0.5) */
export async function listBookings(hotelId: string, f: { from?: string; to?: string; status?: string; source?: string }) {
  const where: SQL[] = [eq(bookings.hotelId, hotelId)];
  if (f.from) where.push(gte(bookings.checkin, f.from));
  if (f.to) where.push(lte(bookings.checkin, f.to));
  if (f.status) where.push(eq(bookings.status, f.status));
  if (f.source) where.push(eq(bookings.source, f.source));
  return db()
    .select({ b: bookings, g: guests, rt: roomTypes })
    .from(bookings)
    .leftJoin(guests, eq(guests.id, bookings.guestId))
    .leftJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
    .leftJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
    .where(and(...where))
    .orderBy(desc(bookings.checkin), desc(bookings.createdAt))
    .limit(500);
}

export async function bookingDetail(hotelId: string, bookingId: string) {
  const [b] = await db().select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)));
  if (!b) return null;
  const [g] = b.guestId ? await db().select().from(guests).where(eq(guests.id, b.guestId)) : [];
  const [room] = await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, b.id));
  const [rt] = room ? await db().select().from(roomTypes).where(eq(roomTypes.id, room.roomTypeId)) : [];
  const [rp] = room?.ratePlanId ? await db().select().from(ratePlans).where(eq(ratePlans.id, room.ratePlanId)) : [];
  const pays = await db().select().from(payments).where(eq(payments.bookingId, b.id));
  const log = await db().select().from(auditLog).where(and(eq(auditLog.hotelId, hotelId), eq(auditLog.entityId, b.id))).orderBy(auditLog.createdAt);
  return { booking: b, guest: g, room, roomType: rt, ratePlan: rp, payments: pays, log };
}

// ---------------------------------------------------------------- Vom Hotel erfasste Buchungen

/**
 * Buchung durch das Hotel erfassen (Telefon, E-Mail, Walk-in). Bezahlt wird vor Ort, darum ohne Stripe und ohne Plattformgebühr
 * (Gebühr nur auf online bezahlte Beträge, Bedingungen für Gastgeber Ziff. 2). Preis, Kurtaxe und obligatorische Zusatzleistungen
 * wie bei der Online-Buchung serverseitig aus dem Kalender. Verfügbarkeit geht über die Outbox an Channex.
 */
// ASSUMPTION: Es gelten dieselben Regeln wie online (Mindestnächte, Anreisesperre, Verkaufsstopp); kein freier Preis (QUESTIONS.md).
export const adminBookingSchema = z.object({
  roomTypeId: z.string().uuid(),
  ratePlanId: z.string().uuid(),
  checkin: z.string().refine(isDay, "Anreise ungültig"),
  checkout: z.string().refine(isDay, "Abreise ungültig"),
  adults: z.number().int().min(1).max(30),
  children: z.number().int().min(0).max(20).default(0),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(20).default([]),
  guest: z.object({
    firstName: z.string().trim().min(1, "Vorname fehlt").max(100),
    lastName: z.string().trim().min(1, "Nachname fehlt").max(100),
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("E-Mail-Adresse prüfen").max(200)]).default(""),
    phone: z.string().trim().max(40).optional(),
    language: z.enum(LOCALES).default("de"),
    notes: z.string().trim().max(2000).optional(),
  }),
  notifyGuest: z.boolean().default(true),
});
export type AdminBookingInput = z.input<typeof adminBookingSchema>;

const REJECT_TEXT: Record<string, string> = {
  sold_out: "Für diese Daten ist nichts mehr frei.",
  min_stay: "Mindestaufenthalt nicht erfüllt (Kalender).",
  max_stay: "Höchstaufenthalt überschritten (Kalender).",
  closed_to_arrival: "An diesem Tag ist keine Anreise möglich (Kalender).",
  closed_to_departure: "An diesem Tag ist keine Abreise möglich (Kalender).",
  stop_sell: "Verkaufsstopp an mindestens einem Tag (Kalender).",
  too_many_guests: "Zu viele Personen für dieses Zimmer.",
  tourist_tax_unconfirmed: "Kurtaxe noch nicht bestätigt (Einstellungen).",
  child_ages_required: "Bitte das Alter der Kinder angeben.",
};
export function bookingErrorText(code: string): string {
  return REJECT_TEXT[code] ?? `Nicht möglich (${code}).`;
}

export async function createAdminBooking(hotel: Hotel, input: AdminBookingInput, actor: string, now = new Date()): Promise<Booking> {
  const v = adminBookingSchema.parse(input);
  const search = await searchOffers(hotel, { checkin: v.checkin, checkout: v.checkout, adults: v.adults, children: v.children, childrenAges: v.childrenAges }, {
    lang: v.guest.language, roomTypeId: v.roomTypeId, ratePlanId: v.ratePlanId, now,
  });
  if (!search.ok) throw new BookingError(search.error, 400);
  const offer = search.offers[0];
  if (!offer) throw new BookingError(search.rejected[0]?.reason ?? "offer_not_found", search.rejected[0]?.reason === "sold_out" ? 409 : 400);
  const extraDefs = await db().select().from(extras).where(and(eq(extras.hotelId, hotel.id), eq(extras.active, true))).orderBy(extras.sortOrder, extras.createdAt);
  const mand = resolveExtras(extraDefs, [], { roomTypeId: v.roomTypeId, nights: nightsOf(v.checkin, v.checkout).length, persons: v.adults + v.children });

  for (let attempt = 0; ; attempt++) {
    try {
      return await db().transaction(async (tx) => {
        if (!(await reserveNights(tx, v.roomTypeId, v.checkin, v.checkout))) throw new RollbackSoldOut();
        const [g] = await tx.insert(guests).values({
          hotelId: hotel.id, firstName: v.guest.firstName, lastName: v.guest.lastName, email: v.guest.email, phone: v.guest.phone || null, language: v.guest.language,
        }).returning();
        const [b] = await tx.insert(bookings).values({
          hotelId: hotel.id, reference: newReference(), publicToken: newPublicToken(), source: "admin", status: "confirmed", confirmedAt: now,
          checkin: v.checkin, checkout: v.checkout, adults: v.adults, children: v.children, childrenAges: v.childrenAges, language: v.guest.language,
          guestId: g.id, roomsTotalRappen: offer.roomsTotalRappen, extrasRappen: mand.totalRappen, touristTaxRappen: offer.touristTaxRappen,
          totalRappen: offer.totalRappen, platformFeeRappen: 0, guestNotes: v.guest.notes || null,
        }).returning();
        await tx.insert(bookingRooms).values({
          bookingId: b.id, hotelId: hotel.id, roomTypeId: v.roomTypeId, ratePlanId: v.ratePlanId, adults: v.adults, children: v.children,
          nightlyPrices: offer.nightlyPrices, amountRappen: offer.roomsTotalRappen,
        });
        if (mand.lines.length) {
          await tx.insert(bookingExtras).values(mand.lines.map((l, position) => ({
            position, bookingId: b.id, hotelId: hotel.id, extraId: l.extra.id, name: l.extra.name, unit: l.extra.unit,
            unitPriceRappen: l.extra.priceRappen, quantity: l.quantity, amountRappen: l.amountRappen,
          })));
        }
        await enqueueAvailability(tx, hotel.id, v.roomTypeId, v.checkin, addDays(v.checkout, -1));
        if (v.notifyGuest && v.guest.email) await scheduleGuestEmails(tx, hotel, b, { confirmation: true, now });
        await audit(tx, { hotelId: hotel.id, actor, action: "booking.admin_create", entity: "booking", entityId: b.id, details: { total: offer.totalRappen, notify: v.notifyGuest } });
        return b;
      });
    } catch (e) {
      if (e instanceof RollbackSoldOut) throw new BookingError("sold_out", 409);
      if (String((e as { code?: string }).code) === "23505" && attempt < 2) continue; // Referenz-Kollision
      throw e;
    }
  }
}

/** Bestätigung (optional) und Erinnerungen an den Gast; alte, noch nicht gesendete Erinnerungen werden ersetzt */
async function scheduleGuestEmails(tx: Tx, hotel: Hotel, b: Booking, opts: { confirmation: boolean; now: Date }) {
  const [g] = b.guestId ? await tx.select().from(guests).where(eq(guests.id, b.guestId)) : [];
  // Löschen statt «cancelled»: der Job für den Check-in-Link legt ihn nur an, wenn noch keiner existiert
  await tx.execute(sql`DELETE FROM email_outbox WHERE booking_id = ${b.id} AND status = 'pending' AND template IN ('pre_arrival','post_stay','checkin_link')`);
  if (!g?.email) return;
  const data = { bookingId: b.id };
  if (opts.confirmation) await enqueueEmail(tx, { hotelId: hotel.id, bookingId: b.id, template: "booking_confirmed", to: g.email, language: b.language, data });
  if (b.checkin > todayIn(hotel.timezone, opts.now)) {
    const at = zonedToUtc(addDays(b.checkin, -3), "10:00", hotel.timezone);
    await enqueueEmail(tx, { hotelId: hotel.id, bookingId: b.id, template: "pre_arrival", to: g.email, language: b.language, data, sendAfter: at < opts.now ? opts.now : at });
  }
  if (g.marketingConsent) {
    await enqueueEmail(tx, { hotelId: hotel.id, bookingId: b.id, template: "post_stay", to: g.email, language: b.language, data, sendAfter: zonedToUtc(addDays(b.checkout, 1), "10:00", hotel.timezone) });
  }
}

/**
 * Aufenthalt verschieben (gleiche Anzahl Nächte, gleiches Zimmer). Die vereinbarten Preise bleiben, damit sich an der
 * Zahlung nichts ändert. Alte Nächte werden freigegeben, neue belegt; Channex erhält die Verfügbarkeit für beide Zeiträume.
 * Portal-Buchungen werden im Portal geändert und kommen über Channex.
 */
// ASSUMPTION: Nur verschieben, nicht verlängern/verkürzen und kein Zimmerwechsel (QUESTIONS.md); Kalenderregeln gelten nicht, nur die Verfügbarkeit.
export async function moveBooking(hotelId: string, bookingId: string, newCheckin: string, opts: { actor: string; notifyGuest: boolean; now?: Date }): Promise<Booking> {
  const now = opts.now ?? new Date();
  if (!isDay(newCheckin)) throw new BookingError("invalid_date", 400);
  try {
    return await db().transaction(async (tx) => {
      const [b] = rows<{ id: string }>(await tx.execute(sql`SELECT id FROM bookings WHERE id = ${bookingId} AND hotel_id = ${hotelId} FOR UPDATE`));
      if (!b) throw new BookingError("not_found", 404);
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
      const [hotel] = await tx.select().from(hotels).where(eq(hotels.id, hotelId));
      if (booking.status !== "confirmed") throw new BookingError("not_confirmed", 409);
      if (booking.source !== "direct" && booking.source !== "admin") throw new BookingError("ota_booking", 409);
      if (newCheckin === booking.checkin) throw new BookingError("same_dates", 400);
      if (newCheckin < todayIn(hotel.timezone, now)) throw new BookingError("in_past", 400);
      const n = nightsOf(booking.checkin, booking.checkout).length;
      const newCheckout = addDays(newCheckin, n);
      const rooms = await tx.select().from(bookingRooms).where(eq(bookingRooms.bookingId, bookingId));
      for (const r of rooms) {
        await releaseNights(tx, hotelId, r.roomTypeId, booking.checkin, booking.checkout);
        if (!(await reserveNights(tx, r.roomTypeId, newCheckin, newCheckout))) throw new RollbackSoldOut();
        await enqueueAvailability(tx, hotelId, r.roomTypeId, newCheckin, addDays(newCheckout, -1));
        const nightly = nightsOf(newCheckin, newCheckout).map((night, i) => ({ night, price_rappen: r.nightlyPrices[i]?.price_rappen ?? 0 }));
        await tx.update(bookingRooms).set({ nightlyPrices: nightly }).where(eq(bookingRooms.id, r.id));
      }
      const [moved] = await tx.update(bookings).set({ checkin: newCheckin, checkout: newCheckout, updatedAt: now }).where(eq(bookings.id, bookingId)).returning();
      await scheduleGuestEmails(tx, hotel, moved, { confirmation: opts.notifyGuest, now });
      await audit(tx, { hotelId, actor: opts.actor, action: "booking.move", entity: "booking", entityId: bookingId, details: { from: [booking.checkin, booking.checkout], to: [newCheckin, newCheckout], notify: opts.notifyGuest } });
      return moved;
    });
  } catch (e) {
    if (e instanceof RollbackSoldOut) throw new BookingError("sold_out", 409);
    throw e;
  }
}
