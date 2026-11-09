import type { Metadata } from "next";
import type { Hotel, SitePage } from "../db/schema";
import { tr } from "../domain/blocks";
import { plainText } from "../domain/richtext";
import { hotelLocales, OG_LOCALES, type Locale } from "../i18n/dict";
import { publicBase } from "../services/brand";

/** Titel, Beschreibung und Vorschaubild (Google, WhatsApp, Social Media) einer Hotel-Seite */
export function pageMetadata(hotel: Hotel, page: SitePage | null, locale: Locale): Metadata {
  const seo = page?.seo?.[locale] ?? {};
  const pageTitle = page && page.slug ? tr(page.title, locale) : "";
  const title = seo.title || (pageTitle ? `${pageTitle} – ${hotel.name}` : hotel.name);
  const hero = page?.blocks.find((b) => b.type === "hero");
  const intro = hero && hero.type === "hero" ? plainText(tr(hero.intro, locale)) : "";
  const description = seo.description || intro.slice(0, 160) || hotel.content?.[locale]?.intro?.slice(0, 160) || undefined;
  const img = (hero && hero.type === "hero" && hero.image?.url) || hotel.content.photos?.[0]?.url;
  const base = publicBase(hotel);
  const origin = new URL(base).origin;
  return {
    title,
    description,
    alternates: { languages: Object.fromEntries(hotelLocales(hotel).map((l) => [l, `${base}/${l}${page?.slug ? `/${page.slug}` : ""}`])) },
    openGraph: { title, description, siteName: hotel.name, locale: OG_LOCALES[locale], images: img ? [{ url: origin + img }] : undefined, type: "website" },
  };
}
