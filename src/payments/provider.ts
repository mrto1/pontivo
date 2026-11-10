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

/** Einfache Zahlung ohne Buchung (z. B. Gutschein) – Direct Charge aufs Hotelkonto mit Plattformgebühr */
export type PaymentCheckoutArgs = {
  hotel: Hotel;
  amountRappen: number;
  feeRappen: number;
  description: string;
  email: string;
  lang: "de" | "en" | "fr" | "it" | "nl";
  successUrl: string;
  cancelUrl: string;
  /** z. B. { voucher_id } – kommt im Webhook zurück */
  metadata: Record<string, string>;
  reference: string;
  idempotencyKey: string;
};

export type RefundArgs = {
  hotel: Hotel;
  booking: Booking;
  paymentIntentId: string | null;
  amountRappen: number;
};

/** Karte für die monatliche Mindestgebühr hinterlegen (Plattform-Konto, nicht das Hotelkonto) */
export type CardSetupArgs = {
  hotel: Hotel;
  email: string;
  /** muss {CHECKOUT_SESSION_ID} enthalten, damit die Rückkehrseite die Session abschliessen kann */
  successUrl: string;
  cancelUrl: string;
};

export type CardSetupResult = { customerId: string; paymentMethodId: string; label: string };

export type ChargeSavedCardArgs = {
  hotel: Hotel;
  customerId: string;
  paymentMethodId: string;
  amountRappen: number;
  description: string;
  receiptEmail: string;
  idempotencyKey: string;
};

export type ChargeResult = { ok: true; paymentIntentId: string } | { ok: false; paymentIntentId: string | null; error: string };

export interface PaymentProvider {
  readonly name: "fake" | "stripe";
  /** true: Zahlung gilt sofort als erfolgt (nur Entwicklung/Tests) */
  readonly confirmsImmediately: boolean;
  createCheckout(args: CheckoutArgs): Promise<{ url: string; sessionId: string }>;
  createPaymentCheckout(args: PaymentCheckoutArgs): Promise<{ url: string; sessionId: string }>;
  refund(args: RefundArgs): Promise<{ refundId: string }>;
  /** Checkout im Modus «setup»: Karte speichern, nichts belasten */
  createCardSetup(args: CardSetupArgs): Promise<{ url: string; sessionId: string }>;
  /** Abgeschlossene Setup-Session auslesen → Kunde, Zahlungsmittel, «Visa •••• 4242» */
  finishCardSetup(hotel: Hotel, sessionId: string): Promise<CardSetupResult>;
  /** Gespeicherte Karte belasten (ohne Gast/Gastgeber am Bildschirm, off_session) */
  chargeSavedCard(args: ChargeSavedCardArgs): Promise<ChargeResult>;
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
