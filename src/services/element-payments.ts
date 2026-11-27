import { and, eq, inArray, isNull, isNotNull, gt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { bookings, hotels, payments, type Hotel } from "../db/schema";
import { stripe } from "../integrations/stripe/client";
import { raiseAlert } from "./monitor";

/**
 * Payment Element (SPEC 19.52): Zahlungen laufen über einen PaymentIntent auf dem Konto des Hotels.
 * Anders als eine Checkout-Session läuft er nicht von selbst ab. Wird die Reservation freigegeben, brechen wir ihn ab,
 * damit der Gast danach nicht mehr bezahlen kann. Ist die Zahlung schon im Gang (processing) oder durch, geht das nicht:
 * dann entscheidet der Webhook (späte Zahlung → Zimmer wieder belegen oder voll zurückerstatten, SPEC 5.4).
 */

/** Stripe-Zustände, in denen der Gast noch zahlen kann */
export const OPEN_INTENT_STATES = ["requires_payment_method", "requires_confirmation", "requires_action"] as const;

type Pending = { id: string; hotelId: string; intent: string };

async function pendingIntents(bookingId: string): Promise<Pending[]> {
  const r = await db()
    .select({ id: payments.id, hotelId: payments.hotelId, intent: payments.stripePaymentIntentId })
    .from(payments)
    .where(and(eq(payments.bookingId, bookingId), eq(payments.status, "pending"), isNull(payments.stripeCheckoutSessionId), isNotNull(payments.stripePaymentIntentId)));
  return r.filter((x): x is Pending => !!x.intent);
}

async function cancelOne(p: Pending): Promise<"canceled" | "not_cancelable" | "error"> {
  const [h] = await db().select().from(hotels).where(eq(hotels.id, p.hotelId));
  if (!h?.stripeAccountId) return "error";
  try {
    await stripe().paymentIntents.cancel(p.intent, { cancellation_reason: "abandoned" }, { stripeAccount: h.stripeAccountId });
    await db().update(payments).set({ status: "failed", updatedAt: new Date() }).where(and(eq(payments.id, p.id), eq(payments.status, "pending")));
    return "canceled";
  } catch (e) {
    const err = e as { code?: string; type?: string; message?: string };
    // Schon abgebrochen: gut. Im Gang oder bezahlt: nicht abbrechbar, der Webhook regelt es.
    if (err.code === "payment_intent_unexpected_state") {
      try {
        const pi = await stripe().paymentIntents.retrieve(p.intent, undefined, { stripeAccount: h.stripeAccountId });
        if (pi.status === "canceled") {
          await db().update(payments).set({ status: "failed", updatedAt: new Date() }).where(and(eq(payments.id, p.id), eq(payments.status, "pending")));
          return "canceled";
        }
      } catch { /* siehe unten */ }
      return "not_cancelable";
    }
    console.error("[element] PaymentIntent konnte nicht abgebrochen werden:", p.intent, err.message);
    return "error";
  }
}

/** Offene PaymentIntents einer freigegebenen Buchung abbrechen. Wirft nie (die Freigabe darf daran nicht scheitern); Fehler holt der Job nach. */
export async function cancelPendingIntents(bookingId: string): Promise<void> {
  try {
    for (const p of await pendingIntents(bookingId)) await cancelOne(p);
  } catch (e) {
    console.error("[element] Abbruch fehlgeschlagen:", (e as Error).message);
  }
}

/** Job: Abbrüche nachholen, die beim Freigeben nicht geklappt haben (Stripe nicht erreichbar). Nur die letzten 2 Tage. */
export async function sweepIntents(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 2 * 864e5);
  const r = await db()
    .select({ id: payments.id, hotelId: payments.hotelId, intent: payments.stripePaymentIntentId, bookingId: payments.bookingId })
    .from(payments)
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .where(and(eq(payments.status, "pending"), isNull(payments.stripeCheckoutSessionId), isNotNull(payments.stripePaymentIntentId), inArray(bookings.status, ["expired", "cancelled"]), gt(payments.createdAt, since)))
    .limit(50);
  let n = 0;
  for (const x of r) {
    if (!x.intent) continue;
    const res = await cancelOne({ id: x.id, hotelId: x.hotelId, intent: x.intent });
    if (res === "canceled") n++;
    else if (res === "not_cancelable") await raiseAlert(`element:not-cancelable:${x.bookingId}`, "Zahlung läuft trotz abgelaufener Reservation", `Buchung ${x.bookingId}: Der PaymentIntent ${x.intent} lässt sich nicht abbrechen (im Gang oder bezahlt). Bitte prüfen, ob die Zahlung zurückerstattet werden muss.`, now, 864e5);
  }
  return n;
}

export type ResumeInfo =
  | { state: "open"; clientSecret: string; stripeAccount: string; amountRappen: number }
  | { state: "paid" | "processing" }
  | { state: "gone" };

/** Offene Zahlung einer Reservation für «Zahlung fortsetzen» (Seite neu geladen, TWINT abgebrochen, Karte abgelehnt) */
export async function resumeIntent(hotel: Hotel, bookingId: string): Promise<ResumeInfo> {
  if (!hotel.stripeAccountId) return { state: "gone" };
  const [p] = await db()
    .select()
    .from(payments)
    .where(and(eq(payments.bookingId, bookingId), eq(payments.hotelId, hotel.id), isNull(payments.stripeCheckoutSessionId), isNotNull(payments.stripePaymentIntentId)))
    .orderBy(sql`${payments.createdAt} DESC`)
    .limit(1);
  if (!p?.stripePaymentIntentId) return { state: "gone" };
  const pi = await stripe().paymentIntents.retrieve(p.stripePaymentIntentId, undefined, { stripeAccount: hotel.stripeAccountId });
  if (pi.status === "succeeded") return { state: "paid" };
  if (pi.status === "processing") return { state: "processing" };
  if ((OPEN_INTENT_STATES as readonly string[]).includes(pi.status) && pi.client_secret) return { state: "open", clientSecret: pi.client_secret, stripeAccount: hotel.stripeAccountId, amountRappen: pi.amount };
  return { state: "gone" };
}

/** Gibt es zur Buchung eine Zahlung per Payment Element (PaymentIntent ohne Checkout-Session) in Wartestellung? */
export async function hasElementPayment(bookingId: string): Promise<boolean> {
  return (await pendingIntents(bookingId)).length > 0;
}
