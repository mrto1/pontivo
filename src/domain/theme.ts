/**
 * Gestaltung der Hotel-Website: Layout und Schriftpaar sind Einstellungen (Daten), kein Code pro Hotel.
 * Alle Layouts verwenden dieselben Bausteine und dasselbe Markup; sie unterscheiden sich nur im CSS
 * (Klasse `layout-<key>` am Rahmen, siehe app/globals.css).
 */

export const LAYOUTS = [
  { key: "klassisch", label: "Klassisch", hint: "Ruhig und übersichtlich: Titelbild, darunter Titel und Suche, Inhalte in Karten" },
  { key: "panorama", label: "Panorama", hint: "Grosses Titelbild über die ganze Breite, Titel direkt auf dem Bild – ideal für Aussicht und Natur" },
  { key: "zentriert", label: "Zentriert", hint: "Logo und Menü mittig, Titel zentriert – wirkt gediegen, passt zu Gasthöfen und Boutique-Hotels" },
  { key: "modern", label: "Modern", hint: "Breit, kräftige Titel, eckige Formen, Menü bleibt beim Scrollen sichtbar – für Stadt- und Designhotels" },
  { key: "landhaus", label: "Landhaus", hint: "Warmer Grundton, gerahmte Bilder, verzierte Titel – für Berg- und Landgasthöfe" },
  { key: "minimal", label: "Minimal", hint: "Viel Weissraum, feine Linien, schlichte Knöpfe – lässt die Fotos wirken" },
  { key: "redaktion", label: "Redaktion", hint: "Wie ein Magazin: grosse linksbündige Titel, nummerierte Abschnitte, kräftige Linien – für Hotels mit Haltung und gutem Text" },
  { key: "galerie", label: "Galerie", hint: "Bildstark und weich: grosse runde Fotos, Zimmer als Bildkacheln, runde Knöpfe – für Häuser mit schönen Fotos" },
] as const;

export const FONTS = [
  { key: "klassisch", label: "Klassisch", head: "Fraunces", body: "Inter" },
  { key: "elegant", label: "Elegant", head: "Cormorant Garamond", body: "Lato" },
  { key: "zeitlos", label: "Zeitlos", head: "Playfair Display", body: "Source Sans 3" },
  { key: "modern", label: "Modern", head: "Manrope", body: "Manrope" },
  { key: "landhaus", label: "Landhaus", head: "Zilla Slab", body: "Work Sans" },
  { key: "freundlich", label: "Freundlich", head: "Nunito", body: "Nunito" },
  { key: "editorial", label: "Editorial", head: "Newsreader", body: "Figtree" },
  { key: "boutique", label: "Boutique", head: "DM Serif Display", body: "DM Sans" },
] as const;

export type LayoutKey = (typeof LAYOUTS)[number]["key"];
export type FontKey = (typeof FONTS)[number]["key"];

export const LAYOUT_KEYS = LAYOUTS.map((l) => l.key) as [LayoutKey, ...LayoutKey[]];
export const FONT_KEYS = FONTS.map((f) => f.key) as [FontKey, ...FontKey[]];

/** Unbekannte oder fehlende Werte → Standard (alte Hotels ohne Einstellung sehen aus wie bisher) */
export function layoutOf(v: string | undefined | null): LayoutKey {
  return (LAYOUT_KEYS as readonly string[]).includes(v ?? "") ? (v as LayoutKey) : "klassisch";
}
export function fontOf(v: string | undefined | null): FontKey {
  return (FONT_KEYS as readonly string[]).includes(v ?? "") ? (v as FontKey) : "klassisch";
}
