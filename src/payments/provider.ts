import type { Booking, Hotel } from "../db/schema";
import { env } from "../env";

export type CheckoutArgs = {
  hotel: Hotel;
  booking: Booking;
  guestEmail: string;
  lang: "de" | "en" | "fr" | "it" | "nl";
  successUrl: string;
  cancelUrl: string;
  /** Zeile für die Zahlungsseite, z. B. "Aufenthalt Demo Gasthof, 2026-12-01–2026-12-03" */
  description: string;
};

export type RefundArgs = {
  hotel: Hotel;
  booking: Booking;
  paymentIntentId: string | null;
  amountRappen: number;
};

export interface PaymentProvider {
  readonly name: "fake" | "stripe";
  /** true: Zahlung gilt sofort als erfolgt (nur Entwicklung/Tests) */
  readonly confirmsImmediately: boolean;
  createCheckout(args: CheckoutArgs): Promise<{ url: string; sessionId: string }>;
  refund(args: RefundArgs): Promise<{ refundId: string }>;
}

let override: PaymentProvider | null = null;

/** Für Tests: anderen Provider einsetzen (null = wieder aus Env) */
export function setPaymentProvider(p: PaymentProvider | null) {
  override = p;
}

export async function getPaymentProvider(): Promise<PaymentProvider> {
  if (override) return override;
  if (env().PAYMENT_PROVIDER === "stripe") {
    const { StripePaymentProvider } = await import("../integrations/stripe/provider");
    return new StripePaymentProvider();
  }
  const { FakePaymentProvider } = await import("./fake");
  return new FakePaymentProvider();
}
