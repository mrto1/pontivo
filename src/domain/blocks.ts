import { z } from "zod";

/**
 * Bausteine der Hotel-Website. Jeder Text ist zweisprachig ({de, en}); fehlt EN, wird DE gezeigt.
 * Bilder sind URLs aus der Foto-Bibliothek des Hotels (/media/<hotelId>/…), PDFs aus der Dokument-Bibliothek.
 */

const text = (max: number) => z.string().max(max).optional();
export const l10n = (max = 4000) => z.object({ de: text(max), en: text(max) }).default({});
const imageUrl = z.string().regex(/^\/media\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{16,64}\.(jpg|png|webp)$/, "Bild aus der Bibliothek wählen");
const image = z.object({ url: imageUrl, alt: text(200) });
/** Erweitert (nicht empfohlen, aber erlaubt): Ausrichtung und Textgrösse pro Baustein */
const look = { align: z.enum(["auto", "left", "center"]).default("auto"), size: z.enum(["normal", "large"]).default("normal") };
const docUrl = z.string().regex(/^\/media\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{16,64}\.pdf$/, "Dokument aus der Bibliothek wählen");

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.literal("hero"), headline: l10n(200), intro: l10n(1000), image: image.nullable().default(null), showSearch: z.boolean().default(true) }),
  z.object({ id: z.string(), type: z.literal("text"), heading: l10n(200), body: l10n(), ...look }),
  z.object({ id: z.string(), type: z.literal("image_text"), heading: l10n(200), body: l10n(), image: image.nullable().default(null), imageSide: z.enum(["left", "right"]).default("left"), ...look }),
  z.object({ id: z.string(), type: z.literal("gallery"), heading: l10n(200), images: z.array(image).max(24).default([]) }),
  z.object({ id: z.string(), type: z.literal("rooms"), heading: l10n(200) }),
  z.object({ id: z.string(), type: z.literal("booking"), heading: l10n(200) }),
  z.object({ id: z.string(), type: z.literal("facts"), heading: l10n(200), items: z.array(z.object({ label: l10n(100), value: l10n(300) })).max(20).default([]) }),
  z.object({ id: z.string(), type: z.literal("location"), heading: l10n(200), address: z.string().max(300).default(""), body: l10n(), ...look }),
  z.object({ id: z.string(), type: z.literal("notice"), body: l10n(1000), ...look }),
  z.object({ id: z.string(), type: z.literal("downloads"), heading: l10n(200), files: z.array(docUrl).max(20).default([]) }),
]);

export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];
export type L = { de?: string; en?: string };

export const BLOCK_TYPES: { type: BlockType; label: string; hint: string }[] = [
  { type: "hero", label: "Titelbild mit Überschrift", hint: "Grosses Bild, Titel, Einleitung und Suchleiste – passt oben auf die Startseite" },
  { type: "text", label: "Text", hint: "Überschrift und Absätze" },
  { type: "image_text", label: "Bild mit Text", hint: "Bild links oder rechts, Text daneben" },
  { type: "gallery", label: "Bildergalerie", hint: "Mehrere Fotos im Raster" },
  { type: "rooms", label: "Zimmerübersicht", hint: "Alle buchbaren Zimmer mit Foto, automatisch aktuell" },
  { type: "booking", label: "Suchleiste", hint: "Anreise, Abreise, Personen – führt zu den freien Zimmern" },
  { type: "facts", label: "Liste mit Angaben", hint: "z. B. Öffnungszeiten, Ausstattung, Preise im Restaurant" },
  { type: "location", label: "Lage & Anreise", hint: "Adresse mit Link zur Route und Text zur Anreise" },
  { type: "notice", label: "Hinweis", hint: "Hervorgehobene Box, z. B. Betriebsferien" },
  { type: "downloads", label: "Downloads (PDF)", hint: "Speisekarte, Preisliste, Seminarunterlagen – aus Ihren Dokumenten" },
];

export function newBlock(type: BlockType, id: string): Block {
  return blockSchema.parse({ id, type });
}

/** Text in der gewünschten Sprache, sonst Deutsch, sonst Englisch */
export function tr(v: L | undefined, lang: "de" | "en"): string {
  if (!v) return "";
  return (lang === "en" ? v.en || v.de : v.de || v.en) ?? "";
}

/** Reservierte Pfade, die keine Seite belegen darf */
export const RESERVED_SLUGS = new Set(["book", "agb", "datenschutz", "b", "h", "admin", "api", "media", "widget", "de", "en"]);

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
