import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { ratePlans, ratesDays, roomTypes, type Hotel, type SitePage } from "../db/schema";
import { tr, type Block } from "../domain/blocks";
import { addDays, todayIn } from "../domain/dates";
import { plainText } from "../domain/richtext";
import { hotelLocales, isLocale, type Locale } from "../i18n/dict";
import { listPages } from "./site";
import { publicBase } from "./brand";

/**
 * GEO (Generative Engine Optimization, SPEC 14e): Das Hotel soll für Suchmaschinen UND KI-Assistenten (ChatGPT, Claude,
 * Perplexity, Gemini) lesbar sein. Alles wird aus den vorhandenen Daten erzeugt, pro Hotel automatisch:
 * sitemap.xml, robots.txt, llms.txt. Keine Hotel-spezifische Logik.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

const defaultLocale = (hotel: Hotel): Locale => {
  const ls = hotelLocales(hotel);
  return isLocale(hotel.defaultLanguage) && ls.includes(hotel.defaultLanguage) ? hotel.defaultLanguage : ls[0];
};

const pageUrl = (hotel: Hotel, locale: Locale, slug: string) => `${publicBase(hotel)}/${locale}${slug ? `/${slug}` : ""}`;

export async function sitemapXml(hotel: Hotel): Promise<string> {
  const locales = hotelLocales(hotel);
  const pages = (await listPages(hotel.id)).filter((p) => p.published);
  // Startseite gibt es immer, auch wenn noch keine Seite angelegt wurde
  const slugs = [...new Set(["", ...pages.map((p) => p.slug)])];
  const lastmod = (slug: string) => pages.find((p) => p.slug === slug)?.updatedAt.toISOString().slice(0, 10);
  const urls = slugs.flatMap((slug) =>
    locales.map((l) => {
      const alts = locales.map((a) => `<xhtml:link rel="alternate" hreflang="${a}" href="${esc(pageUrl(hotel, a, slug))}"/>`).join("");
      const xdef = `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(pageUrl(hotel, defaultLocale(hotel), slug))}"/>`;
      const lm = lastmod(slug);
      return `<url><loc>${esc(pageUrl(hotel, l, slug))}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ""}${alts}${xdef}</url>`;
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}

/** Suchmaschinen und KI-Crawler dürfen alles Öffentliche lesen; Verwaltung, Schnittstellen und persönliche Buchungslinks nicht. */
export function robotsTxt(hotel: Hotel | null): string {
  const lines = ["User-agent: *", "Allow: /", "Disallow: /admin", "Disallow: /api/", "Disallow: /b/", "Disallow: /v/", "Disallow: /vorschau", ""];
  // Die Plattform-Domain selbst hat keine Hotel-Sitemap
  if (hotel) lines.push(`Sitemap: ${publicBase(hotel)}/sitemap.xml`);
  return lines.join("\n") + "\n";
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** Fakten aus den Bausteinen: Fakten-Tabellen, FAQ, Texte (Klartext, begrenzt) */
function blockFacts(blocks: Block[], l: Locale): { facts: string[]; faq: string[]; texts: string[] } {
  const facts: string[] = [];
  const faq: string[] = [];
  const texts: string[] = [];
  for (const b of blocks) {
    if (b.type === "facts") for (const it of b.items) { const k = tr(it.label, l), v = tr(it.value, l); if (k && v) facts.push(`${k}: ${v}`); }
    else if (b.type === "faq") for (const it of b.items) { const q = plainText(tr(it.q, l)), a = plainText(tr(it.a, l)); if (q && a) faq.push(`**${q}** ${clip(a, 600)}`); }
    else if (b.type === "text" || b.type === "image_text") { const h = tr(b.heading, l), body = plainText(tr(b.body, l)); if (body) texts.push(`${h ? `**${h}.** ` : ""}${clip(body, 800)}`); }
    else if (b.type === "location") { const body = plainText(tr(b.body, l)); if (b.address || body) texts.push(`**${tr(b.heading, l) || "Lage"}.** ${[b.address, clip(body, 600)].filter(Boolean).join(" – ")}`); }
  }
  return { facts, faq, texts };
}

/**
 * llms.txt (https://llmstxt.org): eine kurze, gut lesbare Zusammenfassung für KI-Assistenten in der Hauptsprache des Hotels.
 * Nur Angaben, die das Hotel selbst auf der Website pflegt; Preise sind «ab»-Preise der kommenden 12 Monate.
 */
export async function llmsTxt(hotel: Hotel): Promise<string> {
  const l = defaultLocale(hotel);
  const base = publicBase(hotel);
  const today = todayIn(hotel.timezone);
  const pages = (await listPages(hotel.id)).filter((p) => p.published);
  const home = pages.find((p) => p.slug === "");
  const hero = home?.blocks.find((b) => b.type === "hero");
  const summary = (hero?.type === "hero" ? plainText(tr(hero.intro, l)) : "") || hotel.content?.[l]?.intro || "";

  const rooms = await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sortOrder), asc(roomTypes.createdAt));
  const prices = await db()
    .select({ roomTypeId: ratePlans.roomTypeId, min: sql<number>`min(${ratesDays.priceRappen})` })
    .from(ratesDays).innerJoin(ratePlans, eq(ratePlans.id, ratesDays.ratePlanId))
    .where(and(eq(ratesDays.hotelId, hotel.id), eq(ratePlans.active, true), eq(ratesDays.stopSell, false), gte(ratesDays.night, today), lte(ratesDays.night, addDays(today, 365))))
    .groupBy(ratePlans.roomTypeId);
  const minOf = new Map(prices.map((p) => [p.roomTypeId, Number(p.min)]));

  const all = blockFacts(pages.flatMap((p: SitePage) => p.blocks), l);
  const address = [hotel.addressLine, [hotel.postalCode, hotel.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const out: string[] = [`# ${hotel.name}`, ""];
  if (summary) out.push(`> ${clip(summary.replace(/\s+/g, " "), 400)}`, "");
  out.push(
    "## Fakten", "",
    ...(address ? [`- Adresse: ${address}, Schweiz`] : []),
    ...(hotel.contactPhone ? [`- Telefon: ${hotel.contactPhone}`] : []),
    `- E-Mail: ${hotel.contactEmail}`,
    `- Check-in ab ${hotel.checkinTime.slice(0, 5)} Uhr, Check-out bis ${hotel.checkoutTime.slice(0, 5)} Uhr`,
    `- Sprachen der Website: ${hotelLocales(hotel).join(", ")}`,
    "- Zahlung bei Direktbuchung: TWINT, Kreditkarte, Apple Pay, Google Pay (Währung CHF)",
    ...all.facts.map((f) => `- ${f}`),
    "",
  );
  if (rooms.length) {
    out.push("## Zimmer und Wohnungen", "");
    for (const r of rooms) {
      const from = minOf.get(r.id);
      out.push(`- ${r.name}: bis ${r.maxOccupancy} Personen${from ? `, ab CHF ${(from / 100).toFixed(0)} pro Nacht` : ""}${r.description ? ` – ${clip(r.description.replace(/\s+/g, " "), 240)}` : ""}`);
    }
    out.push("");
  }
  out.push("## Direkt buchen", "", `- [Verfügbarkeit prüfen und online buchen](${base}/${l}/book): Direktbuchung beim Haus, keine Vermittlungsprovision, Bestätigung sofort per E-Mail.`, "");
  if (all.faq.length) out.push("## Häufige Fragen", "", ...all.faq.map((f) => `- ${f}`), "");
  if (all.texts.length) out.push("## Über das Haus", "", ...all.texts.slice(0, 8).map((t) => `- ${t}`), "");
  out.push("## Seiten", "");
  for (const p of pages) out.push(`- [${tr(p.title, l) || (p.slug ? p.slug : hotel.name)}](${pageUrl(hotel, l, p.slug)})`);
  if (!pages.length) out.push(`- [${hotel.name}](${pageUrl(hotel, l, "")})`);
  const others = hotelLocales(hotel).filter((x) => x !== l);
  if (others.length) out.push("", "## Weitere Sprachen", "", ...others.map((x) => `- [${x}](${pageUrl(hotel, x, "")})`));
  return out.join("\n") + "\n";
}
