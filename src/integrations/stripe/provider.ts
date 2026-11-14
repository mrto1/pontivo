import type { CardSetupArgs, ChargeSavedCardArgs, ChargeResult, CheckoutArgs, PaymentCheckoutArgs, PaymentProvider, RefundArgs } from "../../payments/provider";
import type { Hotel } from "../../db/schema";
import { feeShare } from "../../domain/deposit";
import { stripe, type Stripe } from "./client";

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
    const cardTotal = booking.totalRappen - booking.voucherRappen;
    const amount = cardTotal - booking.balanceRappen; // bei Anzahlung nur der Teil von heute
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
          application_fee_amount: feeShare(booking.platformFeeRappen, cardTotal, amount),
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
      { stripeAccount: a.hotel.stripeAccountId, idempotencyKey: `refund-${a.booking.id}-${a.paymentIntentId}-${a.amountRappen}` },
    );
    return { refundId: r.id };
  }

  /**
   * Mindestgebühr: Kunde auf dem PLATTFORM-Konto (kein stripeAccount-Header), Checkout im Modus setup.
   * Kartendaten liegen nur bei Stripe; Pontivo speichert Kunde, Zahlungsmittel-ID und «Marke •••• letzte 4».
   */
  async createCardSetup(a: CardSetupArgs) {
    const customerId = a.hotel.billingCustomerId ?? (await stripe().customers.create(
      { email: a.email, name: a.hotel.legalName ?? a.hotel.name, metadata: { hotel_id: a.hotel.id } },
      { idempotencyKey: `billing-customer-${a.hotel.id}` },
    )).id;
    const session = await stripe().checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      currency: "chf",
      allowed_payment_method_types: ["card"],
      success_url: a.successUrl,
      cancel_url: a.cancelUrl,
      metadata: { hotel_id: a.hotel.id, purpose: "platform_minimum" },
    });
    if (!session.url) throw new Error("Stripe lieferte keine Checkout-URL");
    return { url: session.url, sessionId: session.id };
  }

  async finishCardSetup(hotel: Hotel, sessionId: string) {
    const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["setup_intent.payment_method"] });
    if (session.metadata?.hotel_id !== hotel.id) throw new Error("Setup-Session gehört nicht zu diesem Betrieb");
    if (session.status !== "complete") throw new Error("Karte wurde nicht hinterlegt");
    const si = session.setup_intent as Stripe.SetupIntent | null;
    const pm = si?.payment_method as Stripe.PaymentMethod | null;
    if (!pm || typeof session.customer !== "string") throw new Error("Kein Zahlungsmittel in der Session");
    const label = pm.card ? `${pm.card.brand.charAt(0).toUpperCase()}${pm.card.brand.slice(1)} •••• ${pm.card.last4}` : pm.type;
    return { customerId: session.customer, paymentMethodId: pm.id, label };
  }

  async chargeSavedCard(a: ChargeSavedCardArgs): Promise<ChargeResult> {
    try {
      const pi = await stripe().paymentIntents.create(
        {
          amount: a.amountRappen,
          currency: "chf",
          customer: a.customerId,
          payment_method: a.paymentMethodId,
          off_session: true,
          confirm: true,
          description: a.description,
          receipt_email: a.receiptEmail,
          metadata: { hotel_id: a.hotel.id, purpose: "platform_minimum" },
        },
        { idempotencyKey: a.idempotencyKey },
      );
      if (pi.status === "succeeded") return { ok: true, paymentIntentId: pi.id };
      return { ok: false, paymentIntentId: pi.id, error: `Status ${pi.status}` };
    } catch (e) {
      // z. B. card_declined oder authentication_required: Gastgeber muss die Karte erneuern
      const err = e as { code?: string; message?: string; raw?: { payment_intent?: { id?: string } } };
      return { ok: false, paymentIntentId: err.raw?.payment_intent?.id ?? null, error: err.code ?? err.message ?? "Fehler" };
    }
  }
}
