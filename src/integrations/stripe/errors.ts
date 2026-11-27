import { UserError } from "../../domain/errors";

/** Fehler der Stripe-Bibliothek erkennen (Typ «StripeInvalidRequestError», «StripeConnectionError» …) */
export const isStripeError = (e: unknown): e is Error => {
  const type = e instanceof Error ? (e as unknown as { type?: unknown }).type : undefined;
  return typeof type === "string" && type.startsWith("Stripe");
};

/**
 * Stripe-Aufruf aus einer Admin-Aktion: Meldungen von Stripe sind für den Gastgeber verständlich und hilfreich
 * (z. B. fehlende Angaben im Konto) und erscheinen als «Stripe: …». Andere Fehler bleiben Programmfehler.
 */
export async function viaStripe<T>(fn: () => Promise<T>, prefix = "Stripe"): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isStripeError(e)) throw new UserError(`${prefix}: ${e.message}`);
    throw e;
  }
}
