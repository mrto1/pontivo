import { cancelPendingVoucher, markVoucherPaid } from "../../services/vouchers";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { bookings, guests, hotels, inboundEvents, payments, vouchers } from "../../db/schema";
import { env, requireEnv } from "../../env";
import { confirmBooking, releaseHold } from "../../services/bookings";
import { audit } from "../../services/audit";
import { enqueueEmail } from "../../email/enqueue";
import { getPaymentProvider } from "../../payments/provider";
import { stripe, type Stripe } from "./client";
import { syncAccount } from "./onboarding";

export class WebhookSignatureError extends Error {}

/** Signatur prüfen (roher Body!) und Ereignis zurückgeben */
export function verifyStripeEvent(rawBody: string, signature: string | null): Stripe.Event {
  if (!signature) throw new WebhookSignatureError("Signatur fehlt");
  try {
    return stripe().webhooks.constructEvent(rawBody, signature, requireEnv("STRIPE_WEBHOOK_SECRET_CONNECT"));
  } catch (e) {
    throw new WebhookSignatureError((e as Error).message);
  }
}

/**
 * SPEC 6.3. Idempotent: Ereignis wird in inbound_events gespeichert; bereits verarbeitete Ereignisse werden übersprungen.
 * Fehler: inbound_events.error setzen und weiterwerfen (Stripe liefert erneut).
 */
// ASSUMPTION: Verarbeitung direkt im Request (kurz, nur DB-Arbeit). Bei Fehler antwortet der Endpoint 500,
// Stripe wiederholt automatisch; ein unverarbeitetes Ereignis wird bei der Wiederholung erneut verarbeitet.
export async function handleStripeEvent(event: Stripe.Event): Promise<"processed" | "duplicate"> {
  const inserted = await db()
    .insert(inboundEvents)
    .values({ source: "stripe", eventId: event.id, type: event.type, payload: event as unknown as Record<string, unknown> })
    .onConflictDoNothing()
    .returning({ id: inboundEvents.eventId });
  if (inserted.length === 0) {
    const [existing] = await db().select().from(inboundEvents).where(and(eq(inboundEvents.source, "stripe"), eq(inboundEvents.eventId, event.id)));
    if (existing?.processedAt) return "duplicate";
  }
  try {
    await processEvent(event);
    await db().update(inboundEvents).set({ processedAt: new Date(), error: null }).where(and(eq(inboundEvents.source, "stripe"), eq(inboundEvents.eventId, event.id)));
    return "processed";
  } catch (e) {
    await db().update(inboundEvents).set({ error: String((e as Error).stack ?? e).slice(0, 4000) }).where(and(eq(inboundEvents.source, "stripe"), eq(inboundEvents.eventId, event.id)));
    throw e;
  }
}

/** Buchung zur Session laden und prüfen, dass das Ereignis vom Konto dieses Hotels kommt (Mandantentrennung) */
async function bookingForSession(session: Stripe.Checkout.Session, account: string | undefined) {
  const bookingId = session.metadata?.booking_id;
  if (!bookingId) return null;
  const [b] = await db().select().from(bookings).where(eq(bookings.id, bookingId));
  if (!b) return null;
  const [h] = await db().select().from(hotels).where(eq(hotels.id, b.hotelId));
  if (!h || !account || h.stripeAccountId !== account) {
    throw new Error(`Ereignis von Konto ${account} passt nicht zum Hotel der Buchung ${bookingId}`);
  }
  return { booking: b, hotel: h };
}

async function paymentMethodOf(paymentIntentId: string, account: string): Promise<string | null> {
  try {
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] }, { stripeAccount: account });
    const charge = pi.latest_charge as Stripe.Charge | null;
    const det = charge?.payment_method_details;
    if (!det) return null;
    if (det.type === "card" && det.card?.wallet?.type) return det.card.wallet.type; // apple_pay, google_pay
    return det.type; // card, twint
  } catch {
    return null;
  }
}

/** Gutschein zur Session: nur, wenn das Ereignis vom Konto des Hotels kommt */
async function voucherForSession(session: Stripe.Checkout.Session, account: string | undefined) {
  const id = session.metadata?.voucher_id;
  if (!id) return null;
  const [v] = await db().select().from(vouchers).where(eq(vouchers.id, id));
  if (!v) return null;
  const [h] = await db().select().from(hotels).where(eq(hotels.id, v.hotelId));
  if (!h || !account || h.stripeAccountId !== account) throw new Error(`Ereignis von Konto ${account} passt nicht zum Hotel des Gutscheins ${id}`);
  return v;
}

async function onPaid(session: Stripe.Checkout.Session, account: string) {
  const voucher = await voucherForSession(session, account);
  if (voucher) {
    const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
    await markVoucherPaid(voucher.id, { sessionId: session.id, paymentIntentId: piId });
    return;
  }
  const found = await bookingForSession(session, account);
  if (!found) return;
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  const method = piId ? await paymentMethodOf(piId, account) : null;
  const result = await confirmBooking(found.booking.id, {
    sessionId: session.id,
    paymentIntentId: piId,
    method,
    amountRappen: session.amount_total,
    actor: "stripe",
  });
  if (result === "refund_required" && piId) {
    // Zahlung kam nach Ablauf, Zimmer ist weg → volle Rückerstattung inkl. Gebühr (SPEC 5.4)
    const provider = await getPaymentProvider();
    const amount = session.amount_total ?? found.booking.totalRappen;
    await provider.refund({ hotel: found.hotel, booking: found.booking, paymentIntentId: piId, amountRappen: amount });
    await db().transaction(async (tx) => {
      await tx.update(payments).set({ refundedRappen: amount, status: "refunded", updatedAt: new Date() }).where(eq(payments.stripePaymentIntentId, piId));
      const [g] = found.booking.guestId ? await tx.select().from(guests).where(eq(guests.id, found.booking.guestId)) : [];
      const data = { bookingId: found.booking.id, refundRappen: amount };
      if (g) await enqueueEmail(tx, { hotelId: found.hotel.id, bookingId: found.booking.id, template: "late_payment_refunded", to: g.email, language: found.booking.language, data });
      await enqueueEmail(tx, { hotelId: found.hotel.id, bookingId: found.booking.id, template: "late_payment_refunded", to: found.hotel.contactEmail, language: found.hotel.defaultLanguage, data });
      await audit(tx, { hotelId: found.hotel.id, actor: "stripe", action: "booking.late_payment_refunded", entity: "booking", entityId: found.booking.id, details: { amount } });
    });
  }
}

async function processEvent(event: Stripe.Event) {
  const account = event.account ?? undefined;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.payment_status === "paid" && account) await onPaid(s, account);
      return;
    }
    case "checkout.session.async_payment_failed": {
      const vf = await voucherForSession(event.data.object as Stripe.Checkout.Session, account);
      if (vf) return cancelPendingVoucher(vf.id);
      const found = await bookingForSession(event.data.object as Stripe.Checkout.Session, account);
      if (found) await releaseHold(found.booking.id, { reason: "payment_failed", actor: "stripe", paymentFailed: true });
      return;
    }
    case "checkout.session.expired": {
      const v = await voucherForSession(event.data.object as Stripe.Checkout.Session, account);
      if (v) return cancelPendingVoucher(v.id);
      const found = await bookingForSession(event.data.object as Stripe.Checkout.Session, account);
      if (found) await releaseHold(found.booking.id, { reason: "checkout_expired", actor: "stripe", paymentFailed: true });
      return;
    }
    case "charge.refunded": {
      const ch = event.data.object as Stripe.Charge;
      const piId = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id;
      if (!piId) return;
      await db()
        .update(payments)
        .set({
          refundedRappen: ch.amount_refunded,
          status: ch.amount_refunded >= ch.amount ? "refunded" : "partially_refunded",
          updatedAt: new Date(),
        })
        .where(and(eq(payments.stripePaymentIntentId, piId), sql`${payments.hotelId} IN (SELECT id FROM hotels WHERE stripe_account_id = ${account ?? ""})`));
      return;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
      const [p] = piId ? await db().select().from(payments).where(eq(payments.stripePaymentIntentId, piId)) : [];
      const [h] = p ? await db().select().from(hotels).where(eq(hotels.id, p.hotelId)) : await db().select().from(hotels).where(eq(hotels.stripeAccountId, account ?? ""));
      if (!h) return;
      const data = { bookingId: p?.bookingId ?? null, amountRappen: dispute.amount, reason: dispute.reason };
      await enqueueEmail(db(), { hotelId: h.id, bookingId: p?.bookingId ?? null, template: "dispute_alert", to: h.contactEmail, language: h.defaultLanguage, data });
      const alert = env().PLATFORM_ALERT_EMAIL;
      if (alert) await enqueueEmail(db(), { hotelId: h.id, bookingId: p?.bookingId ?? null, template: "dispute_alert", to: alert, data });
      await audit(db(), { hotelId: h.id, actor: "stripe", action: "payment.dispute", entity: "payment", entityId: p?.id, details: data });
      return;
    }
    case "account.updated":
      await syncAccount(event.data.object as Stripe.Account);
      return;
    default:
      return;
  }
}
