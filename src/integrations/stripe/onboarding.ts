import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { hotels, type Hotel } from "../../db/schema";
import { env } from "../../env";
import { audit } from "../../services/audit";
import { stripe, type Stripe } from "./client";

/**
 * SPEC 6.1: Verbundenes Konto, bei dem das Hotel Händler ist, Stripe-Gebühren und Verluste trägt
 * und das volle Stripe-Dashboard hat (Direct-Charges-Modell). Land CH, Firma.
 */
export async function ensureConnectedAccount(hotel: Hotel, actor: string): Promise<string> {
  if (hotel.stripeAccountId) return hotel.stripeAccountId;
  const account = await stripe().accounts.create(
    {
      country: "CH",
      email: hotel.contactEmail,
      // ASSUMPTION: Hotels sind Firmen; B&Bs, Ferienwohnungen, Chalets oft Privatpersonen → Rechtsform wählt der Gastgeber im Stripe-Onboarding
      ...(hotel.propertyType === "hotel" ? { business_type: "company" as const } : {}),
      // ASSUMPTION: Kein MCC vorgeben – das Hotel wählt die Branche im Onboarding (TWINT ist für einzelne Branchencodes eingeschränkt, siehe QUESTIONS.md).
      business_profile: { name: hotel.name },
      controller: {
        fees: { payer: "account" },
        losses: { payments: "stripe" },
        stripe_dashboard: { type: "full" },
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
        twint_payments: { requested: true },
      },
      metadata: { hotel_id: hotel.id },
    },
    { idempotencyKey: `account-${hotel.id}` },
  );
  await db().update(hotels).set({ stripeAccountId: account.id, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
  await audit(db(), { hotelId: hotel.id, actor, action: "stripe.account_create", entity: "hotel", entityId: hotel.id, details: { account: account.id } });
  return account.id;
}

/** Account Link (type=account_onboarding) für den Button im Admin */
export async function onboardingLink(hotel: Hotel, actor: string, returnPath = `/admin/${hotel.id}/settings`): Promise<string> {
  const accountId = await ensureConnectedAccount(hotel, actor);
  const base = env().APP_BASE_URL;
  const sep = returnPath.includes("?") ? "&" : "?";
  const link = await stripe().accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${base}${returnPath}${sep}stripe=refresh`,
    return_url: `${base}${returnPath}${sep}stripe=return`,
  });
  return link.url;
}

/** Webhook account.updated und manuelles Nachladen */
export async function syncAccount(account: Stripe.Account) {
  await db()
    .update(hotels)
    .set({
      stripeChargesEnabled: account.charges_enabled === true,
      stripeTwintActive: account.capabilities?.twint_payments === "active",
      updatedAt: new Date(),
    })
    .where(eq(hotels.stripeAccountId, account.id));
}

export async function refreshAccountStatus(hotel: Hotel) {
  if (!hotel.stripeAccountId) return;
  await syncAccount(await stripe().accounts.retrieve(hotel.stripeAccountId));
}
