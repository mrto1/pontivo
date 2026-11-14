/**
 * Eigene Texte für Gäste-Mails (SPEC 17.5): pro Mail und Sprache ein Betreff, ein Einleitungs- und ein Schlusstext.
 * Nur reiner Text (wird beim Versand maskiert), kein HTML. Rechtlich/inhaltlich wichtige Teile der Mail (Beträge, Daten, Links, Storno)
 * bleiben unverändert; die eigenen Texte kommen dazu.
 */
export const MAIL_TEMPLATES = [
  { key: "booking_confirmed", label: "Buchungsbestätigung" },
  { key: "pre_arrival", label: "Vor der Anreise" },
  { key: "post_stay", label: "Nach dem Aufenthalt" },
  { key: "balance_due", label: "Restzahlung" },
  { key: "invoice_sent", label: "Rechnung" },
] as const;
export type MailTemplateKey = (typeof MAIL_TEMPLATES)[number]["key"];
export const isMailTemplate = (k: string): k is MailTemplateKey => MAIL_TEMPLATES.some((t) => t.key === k);

export type MailText = { subject?: string; intro?: string; outro?: string };
export type MailTexts = Partial<Record<string, Partial<Record<string, MailText>>>>;

export const LIMITS = { subject: 120, intro: 600, outro: 600 } as const;

/** Bereinigt eine Eingabe (nur bekannte Mails und Felder, getrimmt, gekürzt, leere weg) */
export function cleanMailText(t: MailText): MailText {
  const out: MailText = {};
  for (const k of ["subject", "intro", "outro"] as const) {
    const v = (t[k] ?? "").replace(/\r\n/g, "\n").replace(k === "subject" ? /\s+/g : /[ \t]+/g, " ").trim().slice(0, LIMITS[k]);
    if (v) out[k] = v;
  }
  return out;
}

/** Platzhalter {name}, {hotel}, {reference}; Unbekanntes bleibt stehen */
export function fillPlaceholders(s: string, v: { name?: string | null; hotel: string; reference?: string | null }): string {
  return s.replace(/\{(name|hotel|reference)\}/g, (_, k: "name" | "hotel" | "reference") => (k === "name" ? v.name || "" : k === "hotel" ? v.hotel : v.reference || ""));
}

export function mailTextFor(texts: MailTexts | undefined, template: string, lang: string): MailText | null {
  const t = texts?.[template]?.[lang];
  return t && (t.subject || t.intro || t.outro) ? t : null;
}
