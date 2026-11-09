import { chargeVoucher, creditVoucher, takeVoucherForBooking, VoucherError } from "./vouchers";
import { t, type Locale } from "../i18n/dict";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, rows, type Executor, type Tx } from "../db/client";
import {
  bookingRooms, bookings, guests, hotels, payments, ratePlans,
  type Booking, type Hotel,
} from "../db/schema";
import { addDays, nightsOf, todayIn, zonedToUtc } from "../domain/dates";
import { platformFee } from "../domain/pricing";
import { assertTransition } from "../domain/state-machine";
import { quoteCancellation, type CancelQuote } from "../domain/cancellation";
import { newPublicToken, newReference } from "../domain/ids";
import { enqueueAvailability } from "./outbox";
import { audit } from "./audit";
import { enqueueEmail } from "../email/enqueue";
import { getPaymentProvider } from "../payments/provider";
import { isBookable } from "./hotels";
import { searchOffers } from "./search";
import { env } from "../env";

/**
 * Hold-Dauer. SPEC 5.3 nennt 30 Minuten; Stripe Checkout verlangt expires_at >= 30 Minuten
 * NACH Erstellung der Session, die erst nach dem Commit erstellt wird.
 */
// ASSUMPTION: 32 Minuten, damit expires_at (= hold_expires_at) bei Stripe sicher gültig ist.
export const HOLD_MINUTES = 32;

export class BookingError extends Error {
  constructor(public code: string, public httpStatus: number, message?: string) {
    super(message ?? code);
  }
}

export type GuestInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  language: Locale;
  notes?: string | null;
  marketingConsent: boolean;
};

export type CreateBookingInput = {
  /** Gutschein-Code (optional): Betrag wird angerechnet, Rest per Karte/TWINT */
  voucherCode?: string | null;
  roomTypeId: string;
  ratePlanId: string;
  checkin: string;
  checkout: string;
  adults: number;
  children: number;
  childrenAges: number[];
  guest: GuestInput;
};

// ---------------------------------------------------------------- Hold (5.3)

/** Zimmer für alle Nächte atomar belegen. Gibt false zurück, wenn nicht alle Nächte frei waren (Tx muss zurückrollen). */
async function reserveNights(tx: Tx, roomTypeId: string, checkin: string, checkout: string): Promise<boolean> {
  const res = await tx.execute(sql`
    UPDATE inventory_days
       SET booked = booked + 1, updated_at = now()
     WHERE room_type_id = ${roomTypeId} AND night >= ${checkin}::date AND night < ${checkout}::date
       AND total - booked - blocked >= 1
    RETURNING night`);
  return res.rows.length === nightsOf(checkin, checkout).length;
}

async function releaseNights(tx: Tx, hotelId: string, roomTypeId: string, checkin: string, checkout: string) {
  await tx.execute(sql`
    UPDATE inventory_days
       SET booked = booked - 1, updated_at = now()
     WHERE hotel_id = ${hotelId} AND room_type_id = ${roomTypeId}
       AND night >= ${checkin}::date AND night < ${checkout}::date`);
  await enqueueAvailability(tx, hotelId, roomTypeId, checkin, addDays(checkout, -1));
}

class RollbackSoldOut extends Error {}

/**
 * POST /api/bookings: Preis serverseitig neu berechnen, Hold anlegen, Checkout-Session erstellen.
 * Wirft BookingError (409 bei ausgebucht).
 */
export async function createDirectBooking(
  hotel: Hotel,
  input: CreateBookingInput,
  opts: { now?: Date; ip?: string } = {},
): Promise<{ booking: Booking; checkoutUrl: string }> {
  const provider = await getPaymentProvider();
  if (!isBookable(hotel, provider.name)) throw new BookingError("hotel_not_bookable", 403);

  const search = await searchOffers(
    hotel,
    { ...input, childrenAges: input.childrenAges },
    { lang: input.guest.language, roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId, now: opts.now },
  );
  if (!search.ok) throw new BookingError(search.error, 400);
  const offer = search.offers[0];
  if (!offer) {
    const reason = search.rejected[0]?.reason;
    if (reason === "sold_out") throw new BookingError("sold_out", 409);
    // Unbekannter Zimmertyp/Rateplan (auch eines anderen Hotels) → 404, keine Details preisgeben.
    if (!reason) throw new BookingError("offer_not_found", 404);
    throw new BookingError(reason, 400);
  }
  const now = opts.now ?? new Date();
  const today = todayIn(hotel.timezone, now);
  const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);

  let booking: Booking | null = null;
  for (let attempt = 0; attempt < 3 && !booking; attempt++) {
    try {
      booking = await db().transaction(async (tx) => {
        const ok = await reserveNights(tx, input.roomTypeId, input.checkin, input.checkout);
        if (!ok) throw new RollbackSoldOut();
        // Gutschein sperren und anrechnen; 1 % Plattformgebühr nur auf den Teil, der per Karte/TWINT bezahlt wird
        // (am Gutschein hat Pontivo beim Verkauf schon verdient)
        const vt = input.voucherCode?.trim() ? await takeVoucherForBooking(tx, hotel, input.voucherCode, offer.totalRappen, today) : null;
        const voucherRappen = vt?.amountRappen ?? 0;
        const fee = platformFee(offer.totalRappen - voucherRappen, hotel.platformFeeBps);
        const [g] = await tx
          .insert(guests)
          .values({
            hotelId: hotel.id,
            firstName: input.guest.firstName,
            lastName: input.guest.lastName,
            email: input.guest.email.toLowerCase(),
            phone: input.guest.phone ?? null,
            language: input.guest.language,
            marketingConsent: input.guest.marketingConsent,
            marketingConsentAt: input.guest.marketingConsent ? now : null,
          })
          .returning();
        const [b] = await tx
          .insert(bookings)
          .values({
            hotelId: hotel.id,
            reference: newReference(),
            publicToken: newPublicToken(),
            source: "direct",
            status: "hold",
            checkin: input.checkin,
            checkout: input.checkout,
            adults: input.adults,
            children: input.children,
            childrenAges: input.childrenAges,
            language: input.guest.language,
            guestId: g.id,
            roomsTotalRappen: offer.roomsTotalRappen,
            touristTaxRappen: offer.touristTaxRappen,
            totalRappen: offer.totalRappen,
            platformFeeRappen: fee,
            voucherId: vt?.voucher.id ?? null,
            voucherRappen,
            holdExpiresAt,
            guestNotes: input.guest.notes ?? null,
          })
          .returning();
        await tx.insert(bookingRooms).values({
          bookingId: b.id,
          hotelId: hotel.id,
          roomTypeId: input.roomTypeId,
          ratePlanId: input.ratePlanId,
          adults: input.adults,
          children: input.children,
          nightlyPrices: offer.nightlyPrices,
          amountRappen: offer.roomsTotalRappen,
        });
        if (vt) await chargeVoucher(tx, vt.voucher, b.id, voucherRappen, `Buchung ${b.reference}`, "guest");
        await enqueueAvailability(tx, hotel.id, input.roomTypeId, input.checkin, addDays(input.checkout, -1));
        await audit(tx, {
          hotelId: hotel.id, actor: "guest", action: "booking.hold", entity: "booking", entityId: b.id,
          details: { total: offer.totalRappen, fee, voucher: voucherRappen, ip: opts.ip ?? null },
        });
        return b;
      });
    } catch (e) {
      if (e instanceof RollbackSoldOut) throw new BookingError("sold_out", 409);
      if (e instanceof VoucherError) throw new BookingError(e.message, 400);
      // Referenz-Kollision (sehr selten) → neu versuchen
      if (String((e as { code?: string }).code) === "23505" && attempt < 2) continue;
      throw e;
    }
  }
  if (!booking) throw new BookingError("internal", 500);

  const base = env().APP_BASE_URL;
  const lang = input.guest.language;
  const cardRappen = booking.totalRappen - booking.voucherRappen;
  if (cardRappen <= 0) {
    await confirmBooking(booking.id, { method: "voucher", actor: "guest" });
    return { booking, checkoutUrl: `${base}/b/${booking.publicToken}?paid=1` };
  }
  let checkout: { url: string; sessionId: string };
  try {
    checkout = await provider.createCheckout({
      hotel,
      booking,
      guestEmail: input.guest.email,
      lang,
      successUrl: `${base}/b/${booking.publicToken}?paid=1`,
      cancelUrl: `${base}/b/${booking.publicToken}?cancelled_payment=1`,
      description: `${t(lang).stay} ${hotel.name}, ${input.checkin} – ${input.checkout}`,
    });
  } catch (e) {
    await releaseHold(booking.id, { reason: "checkout_failed", actor: "system" });
    throw new BookingError("payment_unavailable", 502, (e as Error).message);
  }

  await db().insert(payments).values({
    hotelId: hotel.id,
    bookingId: booking.id,
    stripeCheckoutSessionId: checkout.sessionId,
    amountRappen: cardRappen,
    applicationFeeRappen: booking.platformFeeRappen,
    status: "pending",
  });

  if (provider.confirmsImmediately) {
    await confirmBooking(booking.id, { sessionId: checkout.sessionId, method: provider.name, actor: "system" });
  }
  return { booking, checkoutUrl: checkout.url };
}

// ---------------------------------------------------------------- Bestätigung (5.4)

export type ConfirmResult = "confirmed" | "already_confirmed" | "ignored" | "refund_required";

export async function confirmBooking(
  bookingId: string,
  pay: {
    sessionId?: string | null;
    paymentIntentId?: string | null;
    method?: string | null;
    amountRappen?: number | null;
    actor: string;
    now?: Date;
  },
): Promise<ConfirmResult> {
  const now = pay.now ?? new Date();
  return db().transaction(async (tx) => {
    const [b] = rows<{ id: string; status: string }>(
      await tx.execute(sql`SELECT id, status FROM bookings WHERE id = ${bookingId} FOR UPDATE`),
    );
    if (!b) throw new BookingError("not_found", 404);
    if (b.status === "confirmed") return "already_confirmed";
    if (b.status === "cancelled" || b.status === "no_show") return "ignored";

    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    const [room] = await tx.select().from(bookingRooms).where(eq(bookingRooms.bookingId, bookingId));

    if (b.status === "expired") {
      // Späte Zahlung: Zimmer erneut belegen, falls noch frei.
      // Savepoint: reserveNights kann einzelne Nächte belegen, obwohl andere voll sind → dann zurückrollen.
      let ok = true;
      try {
        await tx.transaction(async (sp) => {
          if (!(await reserveNights(sp, room.roomTypeId, booking.checkin, booking.checkout))) throw new RollbackSoldOut();
          if (booking.voucherId && booking.voucherRappen > 0) {
            try {
              await chargeVoucher(sp, { id: booking.voucherId, hotelId: booking.hotelId }, booking.id, booking.voucherRappen, `Buchung ${booking.reference} (späte Zahlung)`, pay.actor);
            } catch (e) {
              if (e instanceof VoucherError) throw new RollbackSoldOut();
              throw e;
            }
          }
        });
      } catch (e) {
        if (!(e instanceof RollbackSoldOut)) throw e;
        ok = false;
      }
      if (!ok) {
        await setPaymentInfo(tx, booking, pay, "succeeded");
        await audit(tx, { hotelId: booking.hotelId, actor: pay.actor, action: "booking.late_payment_no_room", entity: "booking", entityId: booking.id });
        return "refund_required";
      }
      await enqueueAvailability(tx, booking.hotelId, room.roomTypeId, booking.checkin, addDays(booking.checkout, -1));
    }

    assertTransition(b.status, "confirmed");
    await tx
      .update(bookings)
      .set({ status: "confirmed", confirmedAt: now, holdExpiresAt: null, updatedAt: now })
      .where(eq(bookings.id, bookingId));
    await setPaymentInfo(tx, booking, pay, "succeeded");
    await audit(tx, { hotelId: booking.hotelId, actor: pay.actor, action: "booking.confirm", entity: "booking", entityId: booking.id, details: { from: b.status } });
    await enqueueBookingEmails(tx, { ...booking, status: "confirmed" }, now);
    return "confirmed";
  });
}

async function setPaymentInfo(
  tx: Tx,
  booking: Booking,
  pay: { sessionId?: string | null; paymentIntentId?: string | null; method?: string | null; amountRappen?: number | null },
  status: "succeeded" | "failed",
) {
  const set = {
    status,
    updatedAt: new Date(),
    ...(pay.paymentIntentId ? { stripePaymentIntentId: pay.paymentIntentId } : {}),
    ...(pay.method ? { method: pay.method } : {}),
    ...(pay.amountRappen != null ? { amountRappen: pay.amountRappen } : {}),
  };
  const where = pay.sessionId
    ? and(eq(payments.bookingId, booking.id), eq(payments.stripeCheckoutSessionId, pay.sessionId))
    : eq(payments.bookingId, booking.id);
  const updated = await tx.update(payments).set(set).where(where).returning({ id: payments.id });
  if (updated.length === 0 && pay.sessionId) {
    await tx.insert(payments).values({
      hotelId: booking.hotelId,
      bookingId: booking.id,
      stripeCheckoutSessionId: pay.sessionId,
      stripePaymentIntentId: pay.paymentIntentId ?? null,
      method: pay.method ?? null,
      amountRappen: pay.amountRappen ?? booking.totalRappen,
      applicationFeeRappen: booking.platformFeeRappen,
      status,
    });
  }
}

async function enqueueBookingEmails(tx: Tx, booking: Booking, now: Date) {
  const [hotel] = await tx.select().from(hotels).where(eq(hotels.id, booking.hotelId));
  const [guest] = booking.guestId ? await tx.select().from(guests).where(eq(guests.id, booking.guestId)) : [];
  const data = { bookingId: booking.id };
  if (guest?.email) {
    await enqueueEmail(tx, { hotelId: hotel.id, bookingId: booking.id, template: "booking_confirmed", to: guest.email, language: booking.language, data });
    // pre_arrival: 3 Tage vor Anreise, 10:00 Hotelzeit (nur wenn Anreise in der Zukunft liegt)
    if (booking.checkin > todayIn(hotel.timezone, now)) {
      const at = zonedToUtc(addDays(booking.checkin, -3), "10:00", hotel.timezone);
      await enqueueEmail(tx, { hotelId: hotel.id, bookingId: booking.id, template: "pre_arrival", to: guest.email, language: booking.language, data, sendAfter: at < now ? now : at });
    }
    if (guest.marketingConsent) {
      const at = zonedToUtc(addDays(booking.checkout, 1), "10:00", hotel.timezone);
      await enqueueEmail(tx, { hotelId: hotel.id, bookingId: booking.id, template: "post_stay", to: guest.email, language: booking.language, data, sendAfter: at });
    }
  }
  await enqueueEmail(tx, { hotelId: hotel.id, bookingId: booking.id, template: "hotel_new_booking", to: hotel.contactEmail, language: hotel.defaultLanguage, data });
}

// ---------------------------------------------------------------- Ablauf und Freigabe (5.5)

/** Gibt einen Hold frei (abgelaufen, Session abgelaufen, Zahlung fehlgeschlagen). Idempotent. */
export async function releaseHold(
  bookingId: string,
  opts: { reason: string; actor: string; paymentFailed?: boolean; now?: Date },
): Promise<boolean> {
  const now = opts.now ?? new Date();
  return db().transaction(async (tx) => {
    const [b] = rows<{ status: string }>(await tx.execute(sql`SELECT status FROM bookings WHERE id = ${bookingId} FOR UPDATE`));
    if (!b || b.status !== "hold") return false;
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    const [room] = await tx.select().from(bookingRooms).where(eq(bookingRooms.bookingId, bookingId));
    await releaseNights(tx, booking.hotelId, room.roomTypeId, booking.checkin, booking.checkout);
    assertTransition("hold", "expired");
    await tx.update(bookings).set({ status: "expired", holdExpiresAt: null, updatedAt: now }).where(eq(bookings.id, bookingId));
    if (booking.voucherId && booking.voucherRappen > 0) {
      await creditVoucher(tx, booking.voucherId, booking.hotelId, booking.id, booking.voucherRappen, `Reservierung ${booking.reference} nicht bezahlt`, opts.actor);
    }
    if (opts.paymentFailed) {
      await tx.update(payments).set({ status: "failed", updatedAt: now }).where(and(eq(payments.bookingId, bookingId), eq(payments.status, "pending")));
    }
    await audit(tx, { hotelId: booking.hotelId, actor: opts.actor, action: "booking.expire", entity: "booking", entityId: bookingId, details: { reason: opts.reason } });
    return true;
  });
}

/** Job alle 60 s: abgelaufene Holds freigeben */
export async function expireHolds(now: Date = new Date()): Promise<number> {
  const due = await db()
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.status, "hold"), lt(bookings.holdExpiresAt, now)));
  let n = 0;
  for (const { id } of due) {
    if (await releaseHold(id, { reason: "hold_expired", actor: "system", now })) n++;
  }
  return n;
}

// ---------------------------------------------------------------- Stornierung (5.7)

async function loadForCancel(ex: Executor, bookingId: string, hotelId?: string) {
  const where = hotelId ? and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)) : eq(bookings.id, bookingId);
  const [booking] = await ex.select().from(bookings).where(where);
  if (!booking) throw new BookingError("not_found", 404);
  const [hotel] = await ex.select().from(hotels).where(eq(hotels.id, booking.hotelId));
  const [room] = await ex.select().from(bookingRooms).where(eq(bookingRooms.bookingId, booking.id));
  const [plan] = room?.ratePlanId ? await ex.select().from(ratePlans).where(eq(ratePlans.id, room.ratePlanId)) : [];
  const [payment] = await ex.select().from(payments).where(and(eq(payments.bookingId, booking.id), eq(payments.status, "succeeded")));
  return { booking, hotel, room, plan, payment };
}

export async function cancellationPreview(
  bookingId: string,
  opts: { by: "guest" | "hotel"; hotelId?: string; now?: Date },
): Promise<CancelQuote & { cancellable: boolean; reason?: string }> {
  const { booking, hotel, plan } = await loadForCancel(db(), bookingId, opts.hotelId);
  const quote = quoteCancellation({
    totalRappen: booking.totalRappen,
    roomsTotalRappen: booking.roomsTotalRappen,
    freeCancelHours: plan?.freeCancelHours ?? null,
    cancelFeeBps: plan?.cancelFeeBps ?? 10000,
    checkin: booking.checkin,
    checkinTime: hotel.checkinTime,
    timezone: hotel.timezone,
    now: opts.now ?? new Date(),
    byHotel: opts.by === "hotel",
  });
  if (booking.status !== "confirmed") return { ...quote, cancellable: false, reason: "status_" + booking.status };
  if (booking.source !== "direct" && booking.source !== "admin") return { ...quote, cancellable: false, reason: "cancel_in_ota_portal" };
  if (opts.by === "guest" && booking.checkin < todayIn(hotel.timezone, opts.now)) return { ...quote, cancellable: false, reason: "past" };
  return { ...quote, cancellable: true };
}

export async function cancelBooking(
  bookingId: string,
  opts: { by: "guest" | "hotel"; actor: string; hotelId?: string; reason?: string; now?: Date },
): Promise<{ refundRappen: number; voucherBackRappen: number; feeRappen: number }> {
  const now = opts.now ?? new Date();
  const preview = await cancellationPreview(bookingId, { by: opts.by, hotelId: opts.hotelId, now });
  if (!preview.cancellable) throw new BookingError(preview.reason ?? "not_cancellable", 409);
  const { booking, hotel, room, payment } = await loadForCancel(db(), bookingId, opts.hotelId);

  // Mit Gutschein bezahlt: Rückerstattung anteilig auf Gutschein und Karte
  const voucherBack = booking.voucherRappen > 0 ? Math.round((preview.refundRappen * booking.voucherRappen) / booking.totalRappen) : 0;
  const cardBack = Math.min(preview.refundRappen - voucherBack, payment ? payment.amountRappen - payment.refundedRappen : 0);

  // 1. Rückerstattung beim Zahlungsanbieter (vor der DB-Änderung, SPEC 5.7)
  let refunded = 0;
  if (payment && cardBack > 0) {
    const provider = await getPaymentProvider();
    await provider.refund({ hotel, booking, paymentIntentId: payment.stripePaymentIntentId, amountRappen: cardBack });
    refunded = cardBack;
  }

  // 2. Nächte freigeben, Status, Outbox, E-Mails
  await db().transaction(async (tx) => {
    const [b] = rows<{ status: string }>(await tx.execute(sql`SELECT status FROM bookings WHERE id = ${bookingId} FOR UPDATE`));
    if (b.status === "cancelled") return; // parallel bereits storniert
    assertTransition(b.status, "cancelled");
    await releaseNights(tx, booking.hotelId, room.roomTypeId, booking.checkin, booking.checkout);
    await tx
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: now, cancelReason: opts.reason ?? `by_${opts.by}`, updatedAt: now })
      .where(eq(bookings.id, bookingId));
    if (payment && refunded > 0) {
      const total = payment.refundedRappen + refunded;
      await tx
        .update(payments)
        .set({ refundedRappen: total, status: total >= payment.amountRappen ? "refunded" : "partially_refunded", updatedAt: now })
        .where(eq(payments.id, payment.id));
    }
    if (booking.voucherId && voucherBack > 0) {
      await creditVoucher(tx, booking.voucherId, booking.hotelId, booking.id, voucherBack, `Storno ${booking.reference}`, opts.actor);
    }
    // Ausstehende Erinnerungen nicht mehr senden
    await tx.execute(sql`UPDATE email_outbox SET status = 'cancelled' WHERE booking_id = ${bookingId} AND status = 'pending' AND template IN ('pre_arrival','post_stay','checkin_link')`);
    const [guest] = booking.guestId ? await tx.select().from(guests).where(eq(guests.id, booking.guestId)) : [];
    const data = { bookingId, refundRappen: refunded, voucherBackRappen: voucherBack, feeRappen: preview.feeRappen };
    if (guest) await enqueueEmail(tx, { hotelId: hotel.id, bookingId, template: "booking_cancelled", to: guest.email, language: booking.language, data });
    await enqueueEmail(tx, { hotelId: hotel.id, bookingId, template: "booking_cancelled", to: hotel.contactEmail, language: hotel.defaultLanguage, data });
    await audit(tx, { hotelId: hotel.id, actor: opts.actor, action: "booking.cancel", entity: "booking", entityId: bookingId, details: { by: opts.by, refund: refunded, voucherBack, fee: preview.feeRappen } });
  });
  return { refundRappen: refunded, voucherBackRappen: voucherBack, feeRappen: preview.feeRappen };
}

// ---------------------------------------------------------------- No-Show (5.8)

export async function markNoShow(hotelId: string, bookingId: string, actor: string, now: Date = new Date()) {
  await db().transaction(async (tx) => {
    const [b] = rows<{ status: string; checkin: string; hotel_id: string }>(
      await tx.execute(sql`SELECT status, checkin, hotel_id FROM bookings WHERE id = ${bookingId} AND hotel_id = ${hotelId} FOR UPDATE`),
    );
    if (!b) throw new BookingError("not_found", 404);
    const [hotel] = await tx.select().from(hotels).where(eq(hotels.id, hotelId));
    if (todayIn(hotel.timezone, now) <= b.checkin) throw new BookingError("too_early", 409, "No-Show frühestens am Tag nach der Anreise");
    assertTransition(b.status, "no_show");
    await tx.update(bookings).set({ status: "no_show", updatedAt: now }).where(eq(bookings.id, bookingId));
    await audit(tx, { hotelId, actor, action: "booking.no_show", entity: "booking", entityId: bookingId });
  });
}

// ---------------------------------------------------------------- Lesen

export async function getBookingByToken(token: string) {
  const [booking] = await db().select().from(bookings).where(eq(bookings.publicToken, token));
  if (!booking) return null;
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, booking.hotelId));
  const [room] = await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, booking.id));
  const { roomTypes } = await import("../db/schema");
  const [roomType] = room ? await db().select().from(roomTypes).where(eq(roomTypes.id, room.roomTypeId)) : [];
  const [plan] = room?.ratePlanId ? await db().select().from(ratePlans).where(eq(ratePlans.id, room.ratePlanId)) : [];
  const [guest] = booking.guestId ? await db().select().from(guests).where(eq(guests.id, booking.guestId)) : [];
  return { booking, hotel, room, roomType, plan, guest };
}
