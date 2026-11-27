import { UserError } from "../../domain/errors";
import type { Hotel } from "../../db/schema";
import { db } from "../../db/client";
import { audit } from "../../services/audit";
import { env } from "../../env";
import { stripe } from "./client";

/**
 * Zahlarten und Domains im Stripe-Konto des Hotels per API (SPEC 19.52).
 * Quellen: Stripe-Doku «Register domains for payment methods» (Connect: `POST /v1/payment_method_domains` mit Header `Stripe-Account`;
 * Apple Pay braucht die Domain bei Elements und eingebettetem Checkout zwingend, gehostetes Checkout nicht) und
 * «Payment Method Configurations API» (Connect: `display_preference.preference` on/off je Zahlart, `available` nur wenn auch die Fähigkeit aktiv ist).
 */

export type WalletKey = "apple_pay" | "google_pay" | "twint";
export const WALLET_KEYS: WalletKey[] = ["apple_pay", "google_pay", "twint"];

export type MethodState = { key: WalletKey; preference: "on" | "off" | "none"; value: "on" | "off"; available: boolean };
export type DomainState = { domain: string; enabled: boolean; apple: string; google: string } | { domain: string; error: string };

export class PaymentMethodsError extends UserError {}

/** Domains, auf denen das Zahlungsformular des Hotels erscheint: eigene Domain und die Pontivo-Adresse (/h/<slug>, /b/<Token>) */
export function hotelDomains(hotel: Pick<Hotel, "primaryDomain">): string[] {
  const out = new Set<string>();
  if (hotel.primaryDomain) out.add(hotel.primaryDomain.toLowerCase());
  try { out.add(new URL(env().APP_BASE_URL).hostname.toLowerCase()); } catch { /* ungültige Basis-Adresse: nur die Hotel-Domain */ }
  // Apple Pay läuft nicht auf localhost und nicht ohne Domain
  return [...out].filter((d) => d.includes(".") && d !== "localhost");
}

let platformId: string | null = null;
async function platformAccountId(): Promise<string> {
  if (platformId) return platformId;
  platformId = (await stripe().accounts.retrieveCurrent()).id;
  return platformId;
}

/** Die Konfiguration, die für das Konto des Hotels gilt (Standard, sonst die erste) */
// ASSUMPTION: `list` mit `application` = Plattform-ID und Header `Stripe-Account` liefert die Konfigurationen des Kontos (Doku-Beispiel «Payment Method Configurations API»); die Standardkonfiguration gilt für Zahlungen ohne `payment_method_configuration`.
async function configOf(hotel: Hotel) {
  if (!hotel.stripeAccountId) throw new PaymentMethodsError("Das Hotel hat noch kein Stripe-Konto.");
  const list = await stripe().paymentMethodConfigurations.list({ application: await platformAccountId() }, { stripeAccount: hotel.stripeAccountId });
  const c = list.data.find((x) => x.is_default) ?? list.data[0];
  if (!c) throw new PaymentMethodsError("Im Stripe-Konto wurde keine Zahlarten-Konfiguration gefunden.");
  return c;
}

export async function methodStates(hotel: Hotel): Promise<MethodState[]> {
  const c = await configOf(hotel);
  return WALLET_KEYS.map((key) => {
    const m = c[key];
    const pick = <T extends string>(v: string | undefined, ok: readonly T[], fallback: T): T => ((ok as readonly string[]).includes(v ?? "") ? (v as T) : fallback);
    return { key, preference: pick(m?.display_preference.preference, ["on", "off", "none"] as const, "none"), value: pick(m?.display_preference.value, ["on", "off"] as const, "off"), available: m?.available ?? false };
  });
}

/** Zahlarten ein- oder ausschalten (nur was sich ändert, wird gesendet) */
export async function setMethods(hotel: Hotel, want: Record<WalletKey, boolean>, actor: string): Promise<void> {
  const c = await configOf(hotel);
  const params: Record<string, { display_preference: { preference: "on" | "off" } }> = {};
  for (const key of WALLET_KEYS) {
    const now = c[key]?.display_preference.value === "on";
    if (c[key] && now !== want[key]) params[key] = { display_preference: { preference: want[key] ? "on" : "off" } };
  }
  if (Object.keys(params).length === 0) return;
  await stripe().paymentMethodConfigurations.update(c.id, params, { stripeAccount: hotel.stripeAccountId! });
  await audit(db(), { hotelId: hotel.id, actor, action: "stripe.payment_methods", entity: "hotel", entityId: hotel.id, details: { want } });
}

/** Domains im Konto des Hotels eintragen oder wieder einschalten. Fehler je Domain, nie ein Abbruch des Ganzen. */
export async function registerDomains(hotel: Hotel, actor: string): Promise<DomainState[]> {
  if (!hotel.stripeAccountId) throw new PaymentMethodsError("Das Hotel hat noch kein Stripe-Konto.");
  const opts = { stripeAccount: hotel.stripeAccountId };
  const out: DomainState[] = [];
  for (const domain of hotelDomains(hotel)) {
    try {
      const found = await stripe().paymentMethodDomains.list({ domain_name: domain, limit: 1 }, opts);
      let d = found.data[0];
      if (!d) d = await stripe().paymentMethodDomains.create({ domain_name: domain }, opts);
      else if (!d.enabled) d = await stripe().paymentMethodDomains.update(d.id, { enabled: true }, opts);
      // Prüft die Domain bei Apple und Google neu (Stripe versucht es bei der Anlage selbst, das hier holt Verzögerungen nach)
      if (d.apple_pay.status !== "active") d = await stripe().paymentMethodDomains.validate(d.id, {}, opts).catch(() => d);
      out.push({ domain, enabled: d.enabled, apple: d.apple_pay.status, google: d.google_pay.status });
    } catch (e) {
      out.push({ domain, error: (e as Error).message });
    }
  }
  await audit(db(), { hotelId: hotel.id, actor, action: "stripe.domains", entity: "hotel", entityId: hotel.id, details: { domains: out } });
  return out;
}

/** Stand der Domains ohne Änderung */
export async function domainStates(hotel: Hotel): Promise<DomainState[]> {
  if (!hotel.stripeAccountId) return [];
  const opts = { stripeAccount: hotel.stripeAccountId };
  const out: DomainState[] = [];
  for (const domain of hotelDomains(hotel)) {
    try {
      const d = (await stripe().paymentMethodDomains.list({ domain_name: domain, limit: 1 }, opts)).data[0];
      out.push(d ? { domain, enabled: d.enabled, apple: d.apple_pay.status, google: d.google_pay.status } : { domain, error: "nicht eingetragen" });
    } catch (e) {
      out.push({ domain, error: (e as Error).message });
    }
  }
  return out;
}

/** Kurztext für die Admin-Meldung nach dem Eintragen */
export function domainSummary(r: DomainState[]): string {
  if (r.length === 0) return "keine Domain zum Eintragen";
  const bad = r.filter((x) => "error" in x);
  if (bad.length) return `Domain-Eintrag fehlgeschlagen für ${bad.map((x) => x.domain).join(", ")}`;
  return `Domains bei Stripe eingetragen (${r.map((x) => x.domain).join(", ")})`;
}
