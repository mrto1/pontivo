import { and, eq, isNull, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { bookings, guests, hotels, payments, type Booking } from "../db/schema";
import { addDays, diffDays, todayIn } from "../domain/dates";
import { enqueueEmail } from "../email/enqueue";
import { env } from "../env";
import { getPaymentProvider } from "../payments/provider";
import { t } from "../i18n/dict";
import { audit } from "./audit";
import { BookingError } from "./bookings";

/** Restzahlung nach einer Anzahlung (SPEC 5.9). Der Gast bezahlt über einen frischen Stripe-Link von der Buchungsseite aus. */

export const REMINDER_AFTER_DAYS = 3;
export const HOTEL_ALERT_DAYS_BEFORE = 2;

const open = (b: Pick<Booking, "status" | "balanceRappen" | "balancePaidAt" | "balanceOnsiteAt">) =>
  b.status === "confirmed" && b.balanceRappen > 0 && !b.balancePaidAt && !b.balanceOnsiteAt;

export const balanceOpen = open;

/** Neue Zahlungsseite für den Restbetrag. Gibt die Adresse zurück, auf die der Gast weitergeleitet wird. */
export async function startBalancePayment(token: string, now = new Date()): Promise<{ url: string }> {
  const [booking] = await db().select().from(bookings).where(eq(bookings.publicToken, token));
  if (!booking) throw new BookingError("not_found", 404);
  if (!open(booking)) throw new BookingError("no_balance_open", 409);
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, booking.hotelId));
  const [guest] = booking.guestId ? await db().select().from(guests).where(eq(guests.id, booking.guestId)) : [];
  const provider = await getPaymentProvider();
  const base = env().APP_BASE_URL;
  const lang = booking.language as "de" | "en" | "fr" | "it" | "nl";
  const paidFee = rows<{ f: number }>(await db().execute(sql`SELECT coalesce(sum(application_fee_rappen),0)::int AS f FROM payments WHERE booking_id = ${booking.id} AND kind <> 'balance' AND status IN ('succeeded','partially_refunded','refunded')`))[0].f;
  const fee = Math.max(0, booking.platformFeeRappen - paidFee);
  // Gleicher Schlüssel innerhalb einer Stunde → gleiche Sitzung; danach eine neue (Stripe-Sitzungen laufen nach 24 h ab)
  const key = `balance-${booking.id}-${Math.floor(now.getTime() / 3_600_000)}`;
  const checkout = await provider.createPaymentCheckout({
    hotel, amountRappen: booking.balanceRappen, feeRappen: Math.min(fee, Math.max(0, booking.balanceRappen - 1)),
    description: `${t(lang).stay} ${hotel.name}, ${booking.checkin} – ${booking.checkout} (${booking.reference})`,
    email: guest?.email ?? hotel.contactEmail, lang,
    successUrl: `${base}/b/${booking.publicToken}?balance_paid=1`, cancelUrl: `${base}/b/${booking.publicToken}`,
    metadata: { booking_id: booking.id, kind: "balance" }, reference: booking.reference, idempotencyKey: key,
  });
  await db().insert(payments).values({
    hotelId: hotel.id, bookingId: booking.id, stripeCheckoutSessionId: checkout.sessionId, amountRappen: booking.balanceRappen,
    applicationFeeRappen: fee, kind: "balance", status: "pending",
  }).onConflictDoNothing();
  if (provider.confirmsImmediately) {
    await markBalancePaid(booking.id, { sessionId: checkout.sessionId, method: "fake", amountRappen: booking.balanceRappen, actor: "system", now });
  }
  return { url: checkout.url };
}

export type BalanceResult = "paid" | "already_paid" | "refund_required";

/** Zahlung des Restbetrags verbuchen (Stripe-Ereignis). Idempotent. `refund_required`: Buchung inzwischen storniert oder schon bezahlt. */
export async function markBalancePaid(
  bookingId: string,
  pay: { sessionId: string; paymentIntentId?: string | null; method?: string | null; amountRappen?: number | null; actor: string; now?: Date },
): Promise<BalanceResult> {
  const now = pay.now ?? new Date();
  return db().transaction(async (tx) => {
    const [b] = rows<{ id: string }>(await tx.execute(sql`SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE`));
    if (!b) throw new BookingError("not_found", 404);
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    const amount = pay.amountRappen ?? booking.balanceRappen;
    const [known] = await tx.select().from(payments).where(and(eq(payments.bookingId, bookingId), eq(payments.stripeCheckoutSessionId, pay.sessionId)));
    if (known?.status === "succeeded") return "already_paid"; // gleiches Ereignis zweimal
    const set = { status: "succeeded", updatedAt: now, ...(pay.paymentIntentId ? { stripePaymentIntentId: pay.paymentIntentId } : {}), ...(pay.method ? { method: pay.method } : {}), amountRappen: amount };
    const settle = async () => {
      if (known) await tx.update(payments).set(set).where(eq(payments.id, known.id));
      else await tx.insert(payments).values({ hotelId: booking.hotelId, bookingId, stripeCheckoutSessionId: pay.sessionId, applicationFeeRappen: 0, kind: "balance", ...set });
    };
    if (!open(booking)) {
      await settle(); // Zahlung ist trotzdem eingegangen und wird für die Rückerstattung festgehalten
      await audit(tx, { hotelId: booking.hotelId, actor: pay.actor, action: "booking.balance_unexpected", entity: "booking", entityId: bookingId, details: { status: booking.status, amount } });
      return "refund_required";
    }
    await settle();
    await tx.update(bookings).set({ balancePaidAt: now, updatedAt: now }).where(eq(bookings.id, bookingId));
    const [g] = booking.guestId ? await tx.select().from(guests).where(eq(guests.id, booking.guestId)) : [];
    if (g) await enqueueEmail(tx, { hotelId: booking.hotelId, bookingId, template: "balance_paid", to: g.email, language: booking.language, data: { amountRappen: amount } });
    await audit(tx, { hotelId: booking.hotelId, actor: pay.actor, action: "booking.balance_paid", entity: "booking", entityId: bookingId, details: { amount } });
    return "paid";
  });
}

/** Hotel hat den Restbetrag vor Ort oder anders erhalten: keine Zahlungsaufforderungen mehr */
export async function markBalanceOnsite(hotelId: string, bookingId: string, actor: string, now = new Date()) {
  await db().transaction(async (tx) => {
    const [b] = rows<{ id: string }>(await tx.execute(sql`SELECT id FROM bookings WHERE id = ${bookingId} AND hotel_id = ${hotelId} FOR UPDATE`));
    if (!b) throw new BookingError("not_found", 404);
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    if (!open(booking)) throw new BookingError("no_balance_open", 409);
    await tx.update(bookings).set({ balanceOnsiteAt: now, updatedAt: now }).where(eq(bookings.id, bookingId));
    await tx.execute(sql`UPDATE email_outbox SET status = 'cancelled' WHERE booking_id = ${bookingId} AND status = 'pending' AND template IN ('balance_due','balance_reminder')`);
    await audit(tx, { hotelId, actor, action: "booking.balance_onsite", entity: "booking", entityId: bookingId, details: { amount: booking.balanceRappen } });
  });
}

/**
 * Job (stündlich): am Fälligkeitstag Aufforderung, nach 3 Tagen Erinnerung, 2 Tage vor Anreise Hinweis an das Hotel.
 * Jede Stufe nur einmal pro Buchung.
 */
export async function balanceJob(now = new Date()): Promise<{ requested: number; reminded: number; alerted: number }> {
  const list = await db().select().from(bookings).where(and(eq(bookings.status, "confirmed"), isNull(bookings.balancePaidAt), isNull(bookings.balanceOnsiteAt), sql`${bookings.balanceRappen} > 0`));
  const out = { requested: 0, reminded: 0, alerted: 0 };
  for (const b of list) {
    const [hotel] = await db().select().from(hotels).where(eq(hotels.id, b.hotelId));
    const today = todayIn(hotel.timezone, now);
    const [g] = b.guestId ? await db().select().from(guests).where(eq(guests.id, b.guestId)) : [];
    const data = { bookingId: b.id };
    if (!b.balanceRequestedAt && b.balanceDueOn && b.balanceDueOn <= today && g) {
      await db().transaction(async (tx) => {
        await tx.update(bookings).set({ balanceRequestedAt: now }).where(eq(bookings.id, b.id));
        await enqueueEmail(tx, { hotelId: b.hotelId, bookingId: b.id, template: "balance_due", to: g.email, language: b.language, data });
      });
      out.requested++;
    } else if (b.balanceRequestedAt && !b.balanceRemindedAt && g && diffDays(b.balanceRequestedAt.toISOString().slice(0, 10), today) >= REMINDER_AFTER_DAYS && b.checkin > today) {
      await db().transaction(async (tx) => {
        await tx.update(bookings).set({ balanceRemindedAt: now }).where(eq(bookings.id, b.id));
        await enqueueEmail(tx, { hotelId: b.hotelId, bookingId: b.id, template: "balance_reminder", to: g.email, language: b.language, data });
      });
      out.reminded++;
    }
    if (!b.balanceAlertedAt && b.balanceRequestedAt && addDays(today, HOTEL_ALERT_DAYS_BEFORE) >= b.checkin) {
      await db().transaction(async (tx) => {
        await tx.update(bookings).set({ balanceAlertedAt: now }).where(eq(bookings.id, b.id));
        await enqueueEmail(tx, { hotelId: b.hotelId, bookingId: b.id, template: "hotel_balance_open", to: hotel.contactEmail, language: hotel.defaultLanguage, data });
      });
      out.alerted++;
    }
  }
  return out;
}
