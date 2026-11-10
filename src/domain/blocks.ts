import { z } from "zod";
import { fallbackChain, type Locale } from "../i18n/dict";

/**
 * Bausteine der Hotel-Website. Jeder Text ist zweisprachig ({de, en}); fehlt EN, wird DE gezeigt.
 * Bilder sind URLs aus der Foto-Bibliothek des Hotels (/media/<hotelId>/…), PDFs aus der Dokument-Bibliothek.
 */

const text = (max: number) => z.string().max(max).optional();
export const l10n = (max = 4000) => z.object({ de: text(max), en: text(max), fr: text(max), it: text(max), nl: text(max) }).default({});
const imageUrl = z.string().regex(/^\/media\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{16,64}\.(jpg|png|webp)$/, "Bild aus der Bibliothek wählen");
const image = z.object({ url: imageUrl, alt: text(200) });
/** Erweitert (nicht empfohlen, aber erlaubt): Ausrichtung und Textgrösse pro Baustein */
const look = { align: z.enum(["auto", "left", "center"]).default("auto"), size: z.enum(["normal", "large"]).default("normal") };
const httpUrl = z.string().trim().max(500).regex(/^https?:\/\/[^\s]+$/, "Adresse mit https:// angeben");
export const TIP_CATEGORIES = ["wandern", "ausflug", "kultur", "essen", "winter", "familie", "see"] as const;
export const INQUIRY_KINDS = ["table", "group", "seminar", "wedding", "company", "other"] as const;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = z.string().regex(TIME_RE, "Zeit als HH:MM");
const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als JJJJ-MM-TT");
export const HOURS_PLACES = ["restaurant", "reception", "other"] as const;
const docUrl = z.string().regex(/^\/media\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{16,64}\.pdf$/, "Dokument aus der Bibliothek wählen");

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.literal("hero"), headline: l10n(200), intro: l10n(1000), image: image.nullable().default(null), showSearch: z.boolean().default(true) }),
  z.object({ id: z.string(), type: z.literal("text"), heading: l10n(200), body: l10n(), ...look }),
  z.object({ id: z.string(), type: z.literal("image_text"), heading: l10n(200), body: l10n(), image: image.nullable().default(null), imageSide: z.enum(["left", "right"]).default("left"), ...look }),
  z.object({ id: z.string(), type: z.literal("gallery"), heading: l10n(200), images: z.array(image).max(24).default([]) }),
  z.object({ id: z.string(), type: z.literal("rooms"), heading: l10n(200) }),
  z.object({ id: z.string(), type: z.literal("booking"), heading: l10n(200) }),
  z.object({ id: z.string(), type: z.literal("facts"), heading: l10n(200), items: z.array(z.object({ label: l10n(100), value: l10n(300) })).max(20).default([]) }),
  z.object({
    id: z.string(), type: z.literal("location"), heading: l10n(200), address: z.string().max(300).default(""), body: l10n(), ...look,
    // Koordinaten für die Karte (OpenStreetMap, lädt erst nach Klick)
    lat: z.number().min(-90).max(90).nullable().default(null), lng: z.number().min(-180).max(180).nullable().default(null),
  }),
  z.object({ id: z.string(), type: z.literal("notice"), body: l10n(1000), ...look }),
  z.object({ id: z.string(), type: z.literal("downloads"), heading: l10n(200), files: z.array(docUrl).max(20).default([]) }),
  // Gästestimmen: nur echte Bewertungen, immer mit Name und Quelle
  z.object({
    id: z.string(), type: z.literal("reviews"), heading: l10n(200),
    items: z.array(z.object({
      quote: l10n(800), author: z.string().trim().max(80).default(""), source: z.string().trim().max(60).default(""),
      date: z.string().regex(/^(\d{4}-\d{2})?$/).default(""), rating: z.number().int().min(1).max(5).nullable().default(null), url: httpUrl.nullable().default(null),
    })).max(12).default([]),
    moreUrl: httpUrl.nullable().default(null),
  }),
  z.object({ id: z.string(), type: z.literal("faq"), heading: l10n(200), items: z.array(z.object({ q: l10n(300), a: l10n(2000) })).max(30).default([]) }),
  // Angebote/Pakete: verweisen auf einen Tarif (z. B. «3 Nächte mit Halbpension», Mindestnächte im Tarif)
  z.object({
    id: z.string(), type: z.literal("offers"), heading: l10n(200),
    items: z.array(z.object({
      title: l10n(120), text: l10n(1000), image: image.nullable().default(null), price: l10n(80),
      ratePlanId: z.string().uuid().nullable().default(null), nights: z.number().int().min(1).max(60).default(1),
    })).max(12).default([]),
  }),
  // Ausflugstipps: strukturiert, damit auch der spätere KI-Chat sie kennt (src/services/knowledge.ts)
  z.object({
    id: z.string(), type: z.literal("tips"), heading: l10n(200), intro: l10n(1000),
    items: z.array(z.object({
      title: l10n(120), text: l10n(1000), image: image.nullable().default(null), category: z.enum(TIP_CATEGORIES).default("ausflug"),
      distance: l10n(80), url: httpUrl.nullable().default(null), season: z.enum(["all", "summer", "winter"]).default("all"),
    })).max(30).default([]),
  }),
  z.object({ id: z.string(), type: z.literal("inquiry"), heading: l10n(200), intro: l10n(1000), kinds: z.array(z.enum(INQUIRY_KINDS)).min(1).default(["group", "seminar", "wedding"]) }),
  z.object({ id: z.string(), type: z.literal("voucher"), heading: l10n(200), intro: l10n(1000) }),
  // Speisekarte: Gerichte mit Rubrik (aufeinanderfolgende gleiche Rubriken werden gruppiert), Preis in Rappen
  z.object({
    id: z.string(), type: z.literal("menu"), heading: l10n(200), intro: l10n(1000),
    items: z.array(z.object({
      section: l10n(80), name: l10n(160), text: l10n(500),
      priceRappen: z.number().int().min(0).max(1_000_000).nullable().default(null),
      diet: z.enum(["", "vegetarian", "vegan"]).default(""), glutenFree: z.boolean().default(false),
    })).max(80).default([]),
    note: l10n(1000),
  }),
  // Öffnungszeiten: 7 Tage (Mo–So), je bis 3 Zeitfenster; leer = geschlossen. Betriebsferien mit Datum.
  z.object({
    id: z.string(), type: z.literal("hours"), heading: l10n(200), place: z.enum(HOURS_PLACES).default("restaurant"),
    days: z.array(z.array(z.object({ from: time, to: time })).max(3)).length(7).default([[], [], [], [], [], [], []]),
    closures: z.array(z.object({ from: dayStr, to: dayStr, label: l10n(120) }).refine((c) => c.to >= c.from, "Ferien: Ende vor Beginn")).max(10).default([]),
    note: l10n(1000),
  }),
]);

export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];
export type L = Partial<Record<Locale, string>>;

export const BLOCK_TYPES: { type: BlockType; label: string; hint: string }[] = [
  { type: "hero", label: "Titelbild mit Überschrift", hint: "Grosses Bild, Titel, Einleitung und Suchleiste – passt oben auf die Startseite" },
  { type: "text", label: "Text", hint: "Überschrift und Absätze" },
  { type: "image_text", label: "Bild mit Text", hint: "Bild links oder rechts, Text daneben" },
  { type: "gallery", label: "Bildergalerie", hint: "Mehrere Fotos im Raster" },
  { type: "rooms", label: "Zimmerübersicht", hint: "Alle buchbaren Zimmer mit Foto, automatisch aktuell" },
  { type: "booking", label: "Suchleiste", hint: "Anreise, Abreise, Personen – führt zu den freien Zimmern" },
  { type: "facts", label: "Liste mit Angaben", hint: "z. B. Ausstattung, Preise, Kontaktangaben" },
  { type: "menu", label: "Speisekarte", hint: "Gerichte mit Rubrik, Beschreibung und Preis – gut lesbar auf dem Handy, wird automatisch übersetzt" },
  { type: "hours", label: "Öffnungszeiten", hint: "Pro Wochentag, mit Ruhetagen und Betriebsferien – Google erkennt die Zeiten" },
  { type: "location", label: "Lage & Anreise", hint: "Adresse mit Link zur Route und Text zur Anreise" },
  { type: "notice", label: "Hinweis", hint: "Hervorgehobene Box, z. B. Betriebsferien" },
  { type: "downloads", label: "Downloads (PDF)", hint: "Speisekarte, Preisliste, Seminarunterlagen – aus Ihren Dokumenten" },
  { type: "offers", label: "Angebote & Pakete", hint: "z. B. «3 Nächte mit Halbpension», direkt buchbar über einen Tarif" },
  { type: "reviews", label: "Gästestimmen", hint: "Echte Bewertungen mit Name und Quelle, Link zu allen Bewertungen" },
  { type: "faq", label: "Häufige Fragen", hint: "Fragen und Antworten zum Aufklappen – spart Anrufe, hilft bei Google" },
  { type: "tips", label: "Ausflugstipps", hint: "Wanderungen, Ausflüge, Restaurants in der Umgebung" },
  { type: "inquiry", label: "Anfrageformular", hint: "Tischreservation, Gruppen, Seminare, Hochzeiten – kommt per E-Mail und im Admin an" },
  { type: "voucher", label: "Gutscheine", hint: "Gäste kaufen Wertgutscheine online, Sie lösen sie im Admin ein" },
];

export function newBlock(type: BlockType, id: string): Block {
  return blockSchema.parse({ id, type });
}

/** Text in der gewünschten Sprache, sonst Englisch, sonst Deutsch (fallbackChain) */
export function tr(v: L | undefined, lang: Locale): string {
  if (!v) return "";
  for (const l of fallbackChain(lang)) if (v[l]) return v[l]!;
  return "";
}

/** Reservierte Pfade, die keine Seite belegen darf */
export const RESERVED_SLUGS = new Set(["book", "agb", "datenschutz", "b", "h", "admin", "api", "media", "widget", "vorschau", "de", "en", "fr", "it", "nl"]);

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Absätze: Leerzeile trennt Absätze, einfacher Zeilenumbruch bleibt */
export function paragraphs(s: string): string[][] {
  return s.split(/\n\s*\n/).map((p) => p.split("\n")).filter((p) => p.join("").trim());
}

/** CSS-Klassen für Ausrichtung/Grösse eines Bausteins ("auto" = wie das Layout es vorsieht) */
export function lookClass(b: { align?: string; size?: string }): string {
  return [b.align === "center" ? "t-center" : b.align === "left" ? "t-left" : "", b.size === "large" ? "t-large" : ""].filter(Boolean).join(" ");
}

/** Öffnungszeiten: aufeinanderfolgende Tage mit gleichen Zeiten zusammenfassen (Index 0 = Montag) */
export function groupDays(days: { from: string; to: string }[][]): { first: number; last: number; ranges: { from: string; to: string }[] }[] {
  const key = (r: { from: string; to: string }[]) => r.map((x) => `${x.from}-${x.to}`).join(",");
  const out: { first: number; last: number; ranges: { from: string; to: string }[] }[] = [];
  days.forEach((r, i) => {
    const prev = out[out.length - 1];
    if (prev && prev.last === i - 1 && key(prev.ranges) === key(r)) prev.last = i;
    else out.push({ first: i, last: i, ranges: r });
  });
  return out;
}

/** Speisekarte: aufeinanderfolgende Gerichte mit gleicher Rubrik (deutscher Text) gruppieren */
export function menuSections<T extends { section: L }>(items: T[]): { section: L; items: T[] }[] {
  const out: { section: L; items: T[] }[] = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (prev && (prev.section.de ?? "") === (it.section.de ?? "")) prev.items.push(it);
    else out.push({ section: it.section, items: [it] });
  }
  return out;
}
