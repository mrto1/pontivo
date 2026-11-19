import type { Locale } from "../i18n/dict";
import { eq, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { bookingRooms, bookings, guests, type Booking, type Hotel } from "../db/schema";
import { addDays, diffDays, isDay, nightsOf, todayIn } from "../domain/dates";

import { audit } from "./audit";
import { enqueueAvailability } from "./outbox";
import { bookingPayload, enqueueWebhook } from "./webhooks";
import { BookingError, priceRoomLines, releaseNights, reserveNights, RollbackSoldOut, type RoomLine } from "./bookings";
import { enqueueEmail } from "../email/enqueue";

export type BookingChange = {
  /** neues Anreisedatum, gleiche Anzahl Nächte, gleiche Zimmer */
  checkin?: string;
  guest?: { firstName?: string; lastName?: string; phone?: string | null };
};

export type ChangeResult = { booking: Booking; changed: string[]; dryRun: boolean };

class DryRun extends Error {
  constructor(public result: ChangeResult) { super("dry_run"); }
}

/**
 * Nachträgliche Änderung über die Website-Schnittstelle (SPEC 19.24).
 * Verschieben (gleiche Nächte, gleiche Zimmer) nur, wenn der Zimmerpreis für die neuen Daten gleich bleibt; sonst 409 `price_differs`,
 * damit sich an Zahlung und Rückerstattung nichts ändert. Kontaktdaten des Gasts (Name, Telefon), nicht die E-Mail-Adresse.
 */
// ASSUMPTION: Nur gleicher Preis erlaubt (kein Nachzahlen/Rückerstatten über die API), kein Verlängern/Verkürzen, kein Zimmerwechsel, keine Änderung der E-Mail-Adresse (Empfänger der Bestätigungen). Das Hotel ändert den Rest im Admin.
export async function changeBookingByApi(hotel: Hotel, bookingId: string, change: BookingChange, opts: { actor: string; dryRun?: boolean; now?: Date }): Promise<ChangeResult> {
  const now = opts.now ?? new Date();
  if (change.checkin !== undefined && !isDay(change.checkin)) throw new BookingError("invalid_date", 400);
  try {
    return await db().transaction(async (tx) => {
      const [lock] = rows<{ id: string }>(await tx.execute(sql`SELECT id FROM bookings WHERE id = ${bookingId} AND hotel_id = ${hotel.id} FOR UPDATE`));
      if (!lock) throw new BookingError("not_found", 404);
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
      if (booking.status !== "confirmed") throw new BookingError("not_confirmed", 409);
      if (booking.source !== "direct" && booking.source !== "admin") throw new BookingError("ota_booking", 409);
      const today = todayIn(hotel.timezone, now);
      const changed: string[] = [];
      let current = booking;

      if (change.checkin !== undefined && change.checkin !== booking.checkin) {
        if (booking.checkin < today) throw new BookingError("stay_started", 409);
        if (change.checkin < today) throw new BookingError("in_past", 400);
        const n = nightsOf(booking.checkin, booking.checkout).length;
        const newCheckin = change.checkin;
        const newCheckout = addDays(newCheckin, n);
        const rooms = await tx.select().from(bookingRooms).where(eq(bookingRooms.bookingId, bookingId));
        // Kinderalter sind nur an der Buchung gespeichert: mit mehreren Zimmern und Kindern lässt sich der Preis nicht sicher neu berechnen
        if (rooms.length > 1 && booking.children > 0) throw new BookingError("price_check_unavailable", 409);
        const lines: RoomLine[] = rooms.map((r) => ({ roomTypeId: r.roomTypeId, ratePlanId: r.ratePlanId!, adults: r.adults, children: r.children, childrenAges: rooms.length === 1 ? booking.childrenAges : [] }));
        if (lines.some((l) => !l.ratePlanId)) throw new BookingError("price_check_unavailable", 409);
        // Eigene Nächte zuerst freigeben (Verschiebung um einen Tag überschneidet sich mit dem alten Aufenthalt), dann bepreisen und belegen; bei Fehler Rollback
        for (const r of rooms) await releaseNights(tx, hotel.id, r.roomTypeId, booking.checkin, booking.checkout);
        const offers = await priceRoomLines(hotel, { checkin: newCheckin, checkout: newCheckout }, lines, booking.language as Locale, now, tx);
        const newRooms = offers.reduce((a, o) => a + o.roomsTotalRappen, 0);
        if (newRooms !== booking.roomsTotalRappen) throw new PriceDiffers(booking.roomsTotalRappen, newRooms);
        for (const r of rooms) if (!(await reserveNights(tx, r.roomTypeId, newCheckin, newCheckout))) throw new RollbackSoldOut();
        for (const [i, r] of rooms.entries()) {
          await tx.update(bookingRooms).set({ nightlyPrices: offers[i].nightlyPrices, amountRappen: offers[i].roomsTotalRappen, roomId: null }).where(eq(bookingRooms.id, r.id));
        }
        for (const rt of new Set(rooms.map((r) => r.roomTypeId))) {
          await enqueueAvailability(tx, hotel.id, rt, booking.checkin, addDays(booking.checkout, -1));
          await enqueueAvailability(tx, hotel.id, rt, newCheckin, addDays(newCheckout, -1));
        }
        const delta = diffDays(booking.checkin, newCheckin);
        [current] = await tx.update(bookings).set({
          checkin: newCheckin, checkout: newCheckout, updatedAt: now,
          balanceDueOn: booking.balanceDueOn && !booking.balancePaidAt ? addDays(booking.balanceDueOn, delta) : booking.balanceDueOn,
        }).where(eq(bookings.id, bookingId)).returning();
        // Alte, noch nicht gesendete Erinnerungen entfernen; Bestätigung mit den neuen Daten an den Gast
        await tx.execute(sql`DELETE FROM email_outbox WHERE booking_id = ${bookingId} AND status = 'pending' AND template IN ('pre_arrival','post_stay','checkin_link','upsell_offer','balance_due','balance_reminder')`);
        const [g] = booking.guestId ? await tx.select().from(guests).where(eq(guests.id, booking.guestId)) : [];
        if (g?.email) await enqueueEmail(tx, { hotelId: hotel.id, bookingId, template: "booking_confirmed", to: g.email, language: booking.language, data: { bookingId } });
        changed.push("checkin", "checkout");
        await audit(tx, { hotelId: hotel.id, actor: opts.actor, action: "api.booking.move", entity: "booking", entityId: bookingId, details: { from: [booking.checkin, booking.checkout], to: [newCheckin, newCheckout] } });
      }

      const g = change.guest;
      if (g && booking.guestId && (g.firstName !== undefined || g.lastName !== undefined || g.phone !== undefined)) {
        const set: Partial<typeof guests.$inferInsert> = {};
        if (g.firstName !== undefined) set.firstName = g.firstName;
        if (g.lastName !== undefined) set.lastName = g.lastName;
        if (g.phone !== undefined) set.phone = g.phone || null;
        await tx.update(guests).set(set).where(eq(guests.id, booking.guestId));
        await tx.update(bookings).set({ updatedAt: now }).where(eq(bookings.id, bookingId));
        changed.push(...Object.keys(set).map((k) => (k === "firstName" ? "first_name" : k === "lastName" ? "last_name" : "phone")));
        await audit(tx, { hotelId: hotel.id, actor: opts.actor, action: "api.booking.guest_update", entity: "booking", entityId: bookingId, details: { fields: Object.keys(set) } });
      }

      const result: ChangeResult = { booking: current, changed, dryRun: !!opts.dryRun };
      if (opts.dryRun) throw new DryRun(result); // alles zurückrollen
      if (changed.length) await enqueueWebhook(tx, hotel.id, "booking.changed", { ...bookingPayload(current), changed }, now);
      return result;
    });
  } catch (e) {
    if (e instanceof DryRun) return e.result;
    if (e instanceof RollbackSoldOut) throw new BookingError("sold_out", 409);
    if (e instanceof PriceDiffers) throw e;
    throw e;
  }
}

export class PriceDiffers extends BookingError {
  constructor(public currentRoomsRappen: number, public newRoomsRappen: number) { super("price_differs", 409); }
}
