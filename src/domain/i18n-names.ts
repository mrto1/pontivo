import { fallbackChain, isLocale, type Locale } from "../i18n/dict";

/** Namen/Beschreibungen von Zimmern und Tarifen in der Sprache des Gastes; Rückfall Englisch, dann Deutsch (Hauptfeld) */
type Tr = { name?: string; description?: string };
type WithI18n = { name: string; description?: string | null; i18n?: Partial<Record<Locale, Tr>> | null };

function pick(r: { i18n?: Partial<Record<Locale, Tr>> | null }, lang: string, key: "name" | "description"): string | undefined {
  const l: Locale = isLocale(lang) ? lang : "de";
  for (const x of fallbackChain(l)) {
    if (x === "de") return undefined; // Deutsch steht im Hauptfeld
    const v = r.i18n?.[x]?.[key];
    if (v) return v;
  }
  return undefined;
}

export function roomName(r: WithI18n, lang: string): string {
  return pick(r, lang, "name") || r.name;
}
export function roomDescription(r: WithI18n, lang: string): string | null {
  return pick(r, lang, "description") || r.description || null;
}
export function planName(p: { name: string; i18n?: Partial<Record<Locale, { name?: string }>> | null }, lang: string): string {
  return pick(p, lang, "name") || p.name;
}
