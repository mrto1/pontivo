import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { hotels, type Hotel, type HotelBrand } from "../db/schema";
import { HEX } from "../domain/brand";
import { FONT_KEYS, LAYOUT_KEYS } from "../domain/theme";
import { LOCALES } from "../i18n/dict";
import { env } from "../env";
import { audit } from "./audit";

export const brandSchema = z.object({
  mode: z.enum(["website", "booking_only"]),
  color: z.string().regex(HEX, "Farbe im Format #rrggbb").nullable(),
  websiteUrl: z
    .string()
    .trim()
    .url("Website als vollständige Adresse, z. B. https://www.hotel.ch")
    .refine((u) => /^https?:\/\//.test(u), "Nur http(s)-Adressen")
    .nullable(),
});

export async function updateBrand(hotel: Hotel, input: z.infer<typeof brandSchema>, actor: string) {
  const v = brandSchema.parse(input);
  if (v.mode === "booking_only" && !v.websiteUrl) throw new z.ZodError([{ code: "custom", path: ["websiteUrl"], message: "Für «nur Buchung» braucht es die Adresse Ihrer Website", input: v.websiteUrl }]);
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  const brand: HotelBrand = { ...h.content.brand, mode: v.mode, color: v.color ?? undefined, websiteUrl: v.websiteUrl ?? undefined };
  await db().update(hotels).set({ content: { ...h.content, brand }, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
  await audit(db(), { hotelId: hotel.id, actor, action: "hotel.brand", entity: "hotel", entityId: hotel.id, details: v });
}

/** Logo setzen oder entfernen; gibt das alte Logo zurück (zum Löschen der Datei) */
export async function setLogo(hotelId: string, logoUrl: string | null, actor: string): Promise<string | undefined> {
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotelId));
  const old = h.content.brand?.logoUrl;
  await db().update(hotels).set({ content: { ...h.content, brand: { ...h.content.brand, logoUrl: logoUrl ?? undefined } } }).where(eq(hotels.id, hotelId));
  await audit(db(), { hotelId, actor, action: logoUrl ? "hotel.logo_set" : "hotel.logo_remove", entity: "hotel", entityId: hotelId });
  return old;
}

/** Öffentliche Basis-URL der Hotel-Seiten: eigene Domain (Produktion) oder Vorschau /h/<slug> */
export function publicBase(hotel: Pick<Hotel, "slug" | "primaryDomain">): string {
  const e = env();
  if (hotel.primaryDomain && e.NODE_ENV === "production") return `https://${hotel.primaryDomain}`;
  return `${e.APP_BASE_URL}/h/${hotel.slug}`;
}

export const designSchema = z.object({
  layout: z.enum(LAYOUT_KEYS),
  font: z.enum(FONT_KEYS),
});

/** Layout und Schrift der Website setzen (Daten, gleicher Code für alle Hotels) */
export async function updateDesign(hotelId: string, input: z.infer<typeof designSchema>, actor: string) {
  const v = designSchema.parse(input);
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotelId));
  await db().update(hotels).set({ content: { ...h.content, brand: { ...h.content.brand, layout: v.layout, font: v.font } }, updatedAt: new Date() }).where(eq(hotels.id, hotelId));
  await audit(db(), { hotelId, actor, action: "hotel.design", entity: "hotel", entityId: hotelId, details: v });
}

export const languagesSchema = z.array(z.enum(["de", "en", "fr", "it", "nl"])).max(5);

/** Angebotene Sprachen der Website setzen. Deutsch ist immer dabei. */
export async function updateLanguages(hotelId: string, input: string[], actor: string) {
  const v = languagesSchema.parse(input);
  const langs = ["de", ...LOCALES.filter((l) => l !== "de" && v.includes(l))];
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotelId));
  await db().update(hotels).set({ content: { ...h.content, languages: langs }, updatedAt: new Date() }).where(eq(hotels.id, hotelId));
  await audit(db(), { hotelId, actor, action: "hotel.languages", entity: "hotel", entityId: hotelId, details: { languages: langs } });
  return langs;
}
