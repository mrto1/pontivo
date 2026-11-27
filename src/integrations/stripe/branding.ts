import { UserError } from "../../domain/errors";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { hotels, type Hotel } from "../../db/schema";
import { audit } from "../../services/audit";
import { imageSize } from "../../lib/image-size";
import { readMedia } from "../../lib/storage";
import { stripe } from "./client";

export const DEFAULT_BRAND_COLOR = "#2f5d50";
const MIN_SIDE = 128;

export class BrandingError extends UserError {}

export type BrandingResult = { color: string; logo: boolean; icon: boolean };

/**
 * Logo und Hauptfarbe des Betriebs auf das Stripe-Konto des Betriebs übernehmen (Zahlungsseite, Belege, Stripe-Mails).
 * Quelle sind die Angaben unter «Website & Buchung» (hotels.content.brand); es gibt keine eigene Eingabe.
 * Das Logo geht immer als «Logo»; ist es quadratisch und mindestens 128 × 128 Pixel, zusätzlich als «Icon».
 */
// ASSUMPTION: Accounts v2, `configuration.merchant.branding` (icon, logo, primary_color, secondary_color; Dateien als Datei-ID).
// Die Bilder werden im Namen des Kontos des Betriebs hochgeladen (Zweck business_logo / business_icon). Muss einmal mit einem echten Test-Konto geprüft werden (QUESTIONS.md).
export async function applyStripeBranding(hotel: Hotel, actor: string): Promise<BrandingResult> {
  if (!hotel.stripeAccountId) throw new BrandingError("Zuerst das Stripe-Konto eröffnen.");
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  const brand = h.content.brand ?? {};
  const color = brand.color ?? DEFAULT_BRAND_COLOR;
  const account = hotel.stripeAccountId;
  const branding: { primary_color: string; secondary_color: string; logo?: string; icon?: string } = { primary_color: color, secondary_color: color };
  let logo = false, icon = false;
  const media = brand.logoUrl ? await readMedia(brand.logoUrl) : null;
  if (media) {
    const size = imageSize(media.bytes);
    const up = async (purpose: "business_logo" | "business_icon") =>
      (await stripe().files.create({ purpose, file: { data: Buffer.from(media.bytes), name: `${purpose}.${media.type.split("/")[1]}`, type: media.type } }, { stripeAccount: account })).id;
    branding.logo = await up("business_logo");
    logo = true;
    if (size && size.width === size.height && size.width >= MIN_SIDE) {
      branding.icon = await up("business_icon");
      icon = true;
    }
  }
  await stripe().v2.core.accounts.update(account, { configuration: { merchant: { branding } } });
  await audit(db(), { hotelId: hotel.id, actor, action: "stripe.branding", entity: "hotel", entityId: hotel.id, details: { color, logo, icon } });
  return { color, logo, icon };
}
