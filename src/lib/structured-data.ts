import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { ratePlans, ratesDays, type Hotel, type SitePage } from "../db/schema";
import { addDays, todayIn } from "../domain/dates";
import { plainText } from "../domain/richtext";
import { menuSections, tr, type Block } from "../domain/blocks";
import { hotelLocales, LOCALE_TAGS, type Locale } from "../i18n/dict";

/**
 * Strukturierte Daten (schema.org, JSON-LD) für Google und KI-Assistenten: Hotel mit Adresse, Kontakt,
 * Check-in/-out, Preisspanne, Koordinaten, Sprachen; FAQ-Seiten als FAQPage.
 * Bewertungen werden bewusst NICHT ausgezeichnet: Google wertet selbst veröffentlichte Bewertungen eines Betriebs nicht.
 */

const fmt = (r: number) => (r / 100).toFixed(0);

export async function hotelJsonLd(hotel: Hotel, locale: Locale, url: string, pages: SitePage[]) {
  const today = todayIn(hotel.timezone);
  const [range] = (
    await db()
      .select({ min: sql<number>`min(${ratesDays.priceRappen})`, max: sql<number>`max(${ratesDays.priceRappen})` })
      .from(ratesDays)
      .innerJoin(ratePlans, eq(ratePlans.id, ratesDays.ratePlanId))
      .where(and(eq(ratesDays.hotelId, hotel.id), eq(ratePlans.active, true), eq(ratesDays.stopSell, false), gte(ratesDays.night, today), lte(ratesDays.night, addDays(today, 365))))
  );
  const loc = pages.flatMap((p) => p.blocks).find((b): b is Extract<Block, { type: "location" }> => b.type === "location" && b.lat !== null && b.lng !== null);
  const photos = (hotel.content.photos ?? []).map((p) => new URL(p.url, url).toString()).slice(0, 6);
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Hotel",
    name: hotel.name,
    url,
    email: hotel.contactEmail,
    ...(hotel.contactPhone ? { telephone: hotel.contactPhone } : {}),
    ...(photos.length ? { image: photos } : {}),
    address: {
      "@type": "PostalAddress",
      ...(hotel.addressLine ? { streetAddress: hotel.addressLine } : {}),
      ...(hotel.postalCode ? { postalCode: hotel.postalCode } : {}),
      ...(hotel.city ? { addressLocality: hotel.city } : {}),
      addressCountry: "CH",
    },
    checkinTime: hotel.checkinTime.slice(0, 5),
    checkoutTime: hotel.checkoutTime.slice(0, 5),
    currenciesAccepted: "CHF",
    paymentAccepted: "TWINT, Credit Card, Apple Pay, Google Pay",
    availableLanguage: hotelLocales(hotel).map((l) => LOCALE_TAGS[l]),
    inLanguage: LOCALE_TAGS[locale],
    ...(range?.min ? { priceRange: `CHF ${fmt(Number(range.min))}–${fmt(Number(range.max))}` } : {}),
    ...(loc ? { geo: { "@type": "GeoCoordinates", latitude: loc.lat, longitude: loc.lng } } : {}),
  };
  return data;
}

export function faqJsonLd(blocks: Block[], locale: Locale) {
  const items = blocks.flatMap((b) => (b.type === "faq" ? b.items : [])).map((it) => ({ q: plainText(tr(it.q, locale)), a: plainText(tr(it.a, locale)) })).filter((x) => x.q && x.a);
  if (!items.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })),
  };
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Restaurant (schema.org/Restaurant) für Seiten mit Speisekarte oder Restaurant-Öffnungszeiten:
 * Öffnungszeiten, Betriebsferien (specialOpeningHoursSpecification, geschlossen = 00:00–00:00), Speisekarte mit Preisen.
 */
export function restaurantJsonLd(hotel: Hotel, blocks: Block[], locale: Locale, url: string) {
  const hours = blocks.find((b): b is Extract<Block, { type: "hours" }> => b.type === "hours" && b.place === "restaurant");
  const menus = blocks.filter((b): b is Extract<Block, { type: "menu" }> => b.type === "menu");
  if (!hours && !menus.length) return null;
  const today = todayIn(hotel.timezone);
  const T = (v: Parameters<typeof tr>[0]) => plainText(tr(v, locale));
  const sections = menus.flatMap((m) => menuSections(m.items.filter((it) => T(it.name))));
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: hotel.name,
    url,
    ...(hotel.contactPhone ? { telephone: hotel.contactPhone } : {}),
    address: {
      "@type": "PostalAddress",
      ...(hotel.addressLine ? { streetAddress: hotel.addressLine } : {}),
      ...(hotel.postalCode ? { postalCode: hotel.postalCode } : {}),
      ...(hotel.city ? { addressLocality: hotel.city } : {}),
      addressCountry: "CH",
    },
    currenciesAccepted: "CHF",
    ...(hours ? {
      openingHoursSpecification: hours.days.flatMap((ranges, i) => ranges.map((r) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: `https://schema.org/${DAYS[i]}`, opens: r.from, closes: r.to }))),
      specialOpeningHoursSpecification: hours.closures.filter((c) => c.to >= today).map((c) => ({ "@type": "OpeningHoursSpecification", opens: "00:00", closes: "00:00", validFrom: c.from, validThrough: c.to })),
    } : {}),
    ...(sections.length ? {
      hasMenu: {
        "@type": "Menu",
        inLanguage: LOCALE_TAGS[locale],
        hasMenuSection: sections.map((sec) => ({
          "@type": "MenuSection",
          ...(T(sec.section) ? { name: T(sec.section) } : {}),
          hasMenuItem: sec.items.map((it) => ({
            "@type": "MenuItem",
            name: T(it.name),
            ...(T(it.text) ? { description: T(it.text) } : {}),
            ...(it.priceRappen !== null ? { offers: { "@type": "Offer", price: (it.priceRappen / 100).toFixed(2), priceCurrency: "CHF" } } : {}),
            ...(it.diet === "vegan" ? { suitableForDiet: "https://schema.org/VeganDiet" } : it.diet === "vegetarian" ? { suitableForDiet: "https://schema.org/VegetarianDiet" } : it.glutenFree ? { suitableForDiet: "https://schema.org/GlutenFreeDiet" } : {}),
          })),
        })),
      },
    } : {}),
  };
}

/** Sicher in <script type="application/ld+json"> einbetten */
export function ldJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
