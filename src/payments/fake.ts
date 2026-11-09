import crypto from "node:crypto";
import type { CheckoutArgs, PaymentCheckoutArgs, PaymentProvider, RefundArgs } from "./provider";

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
}
