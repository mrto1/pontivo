import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { platformSettings } from "../db/schema";
import { cleanOverrides, type FaqItem, type SiteOverrides } from "../domain/pontivo-site";
import { audit } from "./audit";

const KEY = "site_texts";

/** Gespeicherte Änderungen an den Texten der Pontivo-Startseite (null = alles Standard) */
export async function getSiteOverrides(): Promise<SiteOverrides | null> {
  const [r] = await db().select().from(platformSettings).where(eq(platformSettings.key, KEY));
  const v = r?.value as Partial<SiteOverrides> | undefined;
  if (!v || typeof v !== "object") return null;
  return { texts: v.texts && typeof v.texts === "object" ? v.texts : {}, faq: Array.isArray(v.faq) ? v.faq : null };
}

export async function saveSiteOverrides(input: { texts: Record<string, string>; faq: FaqItem[] }, actor: string): Promise<SiteOverrides> {
  const clean = cleanOverrides(input);
  const now = new Date();
  await db().insert(platformSettings).values({ key: KEY, value: clean, updatedAt: now, updatedBy: actor })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value: clean, updatedAt: now, updatedBy: actor } });
  await audit(db(), { hotelId: null, actor, action: "platform.site_texts", entity: "platform_settings", entityId: KEY, details: { changed: Object.keys(clean.texts).length, faqCustom: !!clean.faq } });
  return clean;
}

export async function resetSiteOverrides(actor: string): Promise<void> {
  await db().delete(platformSettings).where(eq(platformSettings.key, KEY));
  await audit(db(), { hotelId: null, actor, action: "platform.site_texts_reset", entity: "platform_settings", entityId: KEY });
}
