import { and, eq } from "drizzle-orm";
import { db, type Executor } from "../db/client";
import { hotels, touristTaxRules, type Hotel, type TouristTaxRule } from "../db/schema";
import { pickRule } from "../domain/tourist-tax";
import { isUuid } from "../lib/uuid";

export function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null;
  return host.split(":")[0].trim().toLowerCase() || null;
}

/** SPEC 3: Hotel über Host-Header (primary_domain). Auch ohne/mit 'www.' */
export async function getHotelByHost(host: string | null | undefined): Promise<Hotel | null> {
  const h = normalizeHost(host);
  if (!h) return null;
  const candidates = h.startsWith("www.") ? [h, h.slice(4)] : [h, "www." + h];
  for (const c of candidates) {
    const [row] = await db().select().from(hotels).where(eq(hotels.primaryDomain, c)).limit(1);
    if (row) return row;
  }
  return null;
}

export async function getHotelBySlug(slug: string): Promise<Hotel | null> {
  const [row] = await db().select().from(hotels).where(eq(hotels.slug, slug)).limit(1);
  return row ?? null;
}

export async function getHotelById(id: string, ex: Executor = db()): Promise<Hotel | null> {
  if (!isUuid(id)) return null;
  const [row] = await ex.select().from(hotels).where(eq(hotels.id, id)).limit(1);
  return row ?? null;
}

/** Öffentliche Auflösung: zuerst Host, dann Slug (Vorschau /h/<slug>) */
export async function resolvePublicHotel(host: string | null, slug?: string | null): Promise<Hotel | null> {
  const byHost = await getHotelByHost(host);
  if (byHost) return byHost;
  if (slug) return getHotelBySlug(slug);
  return null;
}

/** Kurtaxe-Regel für ein Hotel am Anreisetag (SPEC 5.2) */
export async function taxRuleFor(hotel: Hotel, checkin: string, ex: Executor = db()): Promise<TouristTaxRule | null> {
  if (!hotel.municipality) return null;
  const rules = await ex
    .select()
    .from(touristTaxRules)
    .where(
      and(
        eq(touristTaxRules.canton, hotel.canton),
        eq(touristTaxRules.municipality, hotel.municipality),
        eq(touristTaxRules.category, hotel.touristTaxCategory),
      ),
    );
  return pickRule(rules, checkin);
}

/** Buchbar für Gäste? (SPEC 6.1: live erst mit Stripe charges_enabled; bei Fake-Zahlung genügt live) */
export function isBookable(hotel: Hotel, paymentProvider: "fake" | "stripe"): boolean {
  if (hotel.status !== "live") return false;
  if (paymentProvider === "stripe" && (!hotel.stripeAccountId || !hotel.stripeChargesEnabled)) return false;
  return true;
}
