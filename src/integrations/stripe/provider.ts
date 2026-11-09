import type { CheckoutArgs, PaymentCheckoutArgs, PaymentProvider, RefundArgs } from "../../payments/provider";
import { stripe } from "./client";

/** TWINT-Limit pro Zahlung (Stripe): CHF 5'000 */
export const TWINT_MAX_RAPPEN = 500_000;

/** SPEC 6.2 Checkout Session als Direct Charge auf dem Konto des Hotels; SPEC 6.4 Refund */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  readonly confirmsImmediately = false;

  async createCheckout(a: CheckoutArgs) {
    const { hotel, booking } = a;
    if (!hotel.stripeAccountId) throw new Error("Hotel hat kein Stripe-Konto");
    if (!booking.holdExpiresAt) throw new Error("Buchung ohne Hold-Ablauf");
    // Mit Gutschein: nur der Restbetrag wird per Karte/TWINT bezahlt
    const amount = booking.totalRappen - booking.voucherRappen;
    const twintAllowed = hotel.stripeTwintActive && amount <= TWINT_MAX_RAPPEN;
    const metadata = { booking_id: booking.id, hotel_id: hotel.id };
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        currency: "chf",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "chf",
              unit_amount: amount,
              product_data: { name: a.description },
            },
          },
        ],
        payment_intent_data: {
          application_fee_amount: booking.platformFeeRappen,
          metadata,
        },
        metadata,
        client_reference_id: booking.reference,
        customer_email: a.guestEmail,
        locale: a.lang,
        expires_at: Math.floor(booking.holdExpiresAt.getTime() / 1000),
        success_url: a.successUrl,
        cancel_url: a.cancelUrl,
        // Zahlarten kommen aus den Stripe-Einstellungen (dynamisch). TWINT nur, wenn aktiv und unter dem Limit.
        ...(twintAllowed ? {} : { excluded_payment_method_types: ["twint"] }),
      },
      { stripeAccount: hotel.stripeAccountId, idempotencyKey: `checkout-${booking.id}` },
    );
    if (!session.url) throw new Error("Stripe lieferte keine Checkout-URL");
    return { url: session.url, sessionId: session.id };
  }

  /** Gutschein & Co.: gleiche Direct Charge wie bei Buchungen, ohne Hold-Ablauf (Stripe-Standard 24 h) */
  async createPaymentCheckout(a: PaymentCheckoutArgs) {
    const { hotel } = a;
    if (!hotel.stripeAccountId) throw new Error("Hotel hat kein Stripe-Konto");
    const twintAllowed = hotel.stripeTwintActive && a.amountRappen <= TWINT_MAX_RAPPEN;
    const metadata = { ...a.metadata, hotel_id: hotel.id };
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        currency: "chf",
        line_items: [{ quantity: 1, price_data: { currency: "chf", unit_amount: a.amountRappen, product_data: { name: a.description } } }],
        payment_intent_data: { application_fee_amount: a.feeRappen, metadata },
        metadata,
        client_reference_id: a.reference,
        customer_email: a.email,
        locale: a.lang,
        success_url: a.successUrl,
        cancel_url: a.cancelUrl,
        ...(twintAllowed ? {} : { excluded_payment_method_types: ["twint"] }),
      },
      { stripeAccount: hotel.stripeAccountId, idempotencyKey: a.idempotencyKey },
    );
    if (!session.url) throw new Error("Stripe lieferte keine Checkout-URL");
    return { url: session.url, sessionId: session.id };
  }

  async refund(a: RefundArgs) {
    if (!a.hotel.stripeAccountId) throw new Error("Hotel hat kein Stripe-Konto");
    if (!a.paymentIntentId) throw new Error("Zahlung ohne PaymentIntent");
    const r = await stripe().refunds.create(
      { payment_intent: a.paymentIntentId, amount: a.amountRappen, refund_application_fee: true },
      { stripeAccount: a.hotel.stripeAccountId, idempotencyKey: `refund-${a.booking.id}-${a.amountRappen}` },
    );
    return { refundId: r.id };
  }
}
