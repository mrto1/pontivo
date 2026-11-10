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
  // Stripe verlangt für neue Connect-Integrationen Accounts v2 (POST /v2/core/accounts); v1-Konten-Erstellung ist gesperrt.
  // Gleiches Modell wie bisher: volles Stripe-Dashboard, Betrieb zahlt die Stripe-Gebühren, Stripe trägt Verluste (Direct Charges).
  const account = await stripe().v2.core.accounts.create(
    {
      contact_email: hotel.contactEmail,
      display_name: hotel.name,
      // ASSUMPTION: Hotels sind Firmen; B&Bs, Ferienwohnungen, Chalets oft Privatpersonen → Rechtsform wählt der Gastgeber im Stripe-Onboarding
      identity: { country: "ch", ...(hotel.propertyType === "hotel" ? { entity_type: "company" as const } : {}) },
      configuration: {
        merchant: {
          capabilities: { card_payments: { requested: true }, twint_payments: { requested: true } },
        },
      },
      defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
      dashboard: "full",
      metadata: { hotel_id: hotel.id },
    },
    { idempotencyKey: `account-v2-${hotel.id}` },
  );
  await db().update(hotels).set({ stripeAccountId: account.id, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
  await audit(db(), { hotelId: hotel.id, actor, action: "stripe.account_create", entity: "hotel", entityId: hotel.id, details: { account: account.id, api: "v2" } });
  return account.id;
}

/** Account Link (type=account_onboarding) für den Button im Admin */
export async function onboardingLink(hotel: Hotel, actor: string, returnPath = `/admin/${hotel.id}/settings`): Promise<string> {
  const accountId = await ensureConnectedAccount(hotel, actor);
  const base = env().APP_BASE_URL;
  const sep = returnPath.includes("?") ? "&" : "?";
  const link = await stripe().v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: { refresh_url: `${base}${returnPath}${sep}stripe=refresh`, return_url: `${base}${returnPath}${sep}stripe=return` },
    },
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

/**
 * Eingebettetes Onboarding (Connect embedded components): Account Session für das Konto des Betriebs.
 * Der Client-Schlüssel ist kurzlebig und gilt nur für dieses Konto und diese Komponenten.
 */
export async function onboardingSession(hotel: Hotel, actor: string): Promise<string> {
  const account = await ensureConnectedAccount(hotel, actor);
  const session = await stripe().accountSessions.create({
    account,
    components: {
      account_onboarding: { enabled: true, features: { external_account_collection: true } },
    },
  });
  return session.client_secret;
}
