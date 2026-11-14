import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { hotels, type Hotel } from "../db/schema";
import { cleanMailText, isMailTemplate, type MailText, type MailTexts } from "../domain/mail-texts";
import { isLocale } from "../i18n/dict";
import { audit } from "./audit";

/** Eigene Mail-Texte (SPEC 17.5) für eine Mail in den angegebenen Sprachen speichern; leere Felder löschen den Eintrag. */
export async function saveMailTexts(hotel: Hotel, template: string, perLang: Record<string, MailText>, actor: string): Promise<void> {
  if (!isMailTemplate(template)) throw new Error("Unbekannte Mail.");
  const all: MailTexts = { ...(hotel.content.mailTexts ?? {}) };
  const cur = { ...(all[template] ?? {}) };
  for (const [lang, t] of Object.entries(perLang)) {
    if (!isLocale(lang)) continue;
    const c = cleanMailText(t);
    if (Object.keys(c).length) cur[lang] = c; else delete cur[lang];
  }
  if (Object.keys(cur).length) all[template] = cur; else delete all[template];
  await db().update(hotels).set({ content: { ...hotel.content, mailTexts: all }, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
  await audit(db(), { hotelId: hotel.id, actor, action: "mail.texts", entity: "hotel", entityId: hotel.id, details: { template, languages: Object.keys(cur) } });
}
