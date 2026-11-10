import crypto from "node:crypto";
import type { CardSetupArgs, ChargeSavedCardArgs, CheckoutArgs, PaymentCheckoutArgs, PaymentProvider, RefundArgs } from "./provider";
import type { Hotel } from "../db/schema";

/**
 * PAYMENT_PROVIDER=fake (SPEC 12, M1): keine echte Zahlung.
 * Der Buchungsablauf bestätigt die Buchung sofort und leitet auf die Erfolgsseite weiter.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake" as const;
  readonly confirmsImmediately = true;
  refunds: RefundArgs[] = [];

  async createCheckout(args: CheckoutArgs) {
    return { url: args.successUrl, sessionId: `fake_cs_${args.booking.id}` };
  }

  async createPaymentCheckout(args: PaymentCheckoutArgs) {
    return { url: args.successUrl, sessionId: `fake_cs_${args.idempotencyKey}` };
  }

  async refund(args: RefundArgs) {
    this.refunds.push(args);
    return { refundId: `fake_re_${crypto.randomUUID()}` };
  }

  async createCardSetup(args: CardSetupArgs) {
    const sessionId = `fake_setup_${args.hotel.id}`;
    return { url: args.successUrl.replace("{CHECKOUT_SESSION_ID}", sessionId), sessionId };
  }

  async finishCardSetup(hotel: Hotel, sessionId: string) {
    if (sessionId !== `fake_setup_${hotel.id}`) throw new Error("Unbekannte Setup-Session");
    return { customerId: `fake_cus_${hotel.id}`, paymentMethodId: `fake_pm_${hotel.id}`, label: "Testkarte •••• 4242" };
  }

  charges: ChargeSavedCardArgs[] = [];
  async chargeSavedCard(args: ChargeSavedCardArgs) {
    this.charges.push(args);
    return { ok: true as const, paymentIntentId: `fake_pi_${args.idempotencyKey}` };
  }
}
