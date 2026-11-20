import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { platformSettings } from "../db/schema";
import { DEFAULT_PLATFORM_VAT, cleanPlatformVat, type PlatformVat } from "../domain/platform-invoice";
import { env } from "../env";
import { audit } from "./audit";

const VAT_KEY = "vat";

/** MWST-Angaben der Plattform (Schalter in der Plattform-Verwaltung). Ohne Eintrag: nicht MWST-pflichtig. */
export async function getPlatformVat(): Promise<PlatformVat> {
  const [r] = await db().select().from(platformSettings).where(eq(platformSettings.key, VAT_KEY));
  const v = ((r?.value && typeof r.value === "object" ? r.value : {}) as Partial<PlatformVat>);
  return {
    liableFrom: v.liableFrom ?? null,
    bps: typeof v.bps === "number" ? v.bps : DEFAULT_PLATFORM_VAT.bps,
    number: v.number || env().PLATFORM_VAT_NUMBER || "",
  };
}

export async function savePlatformVat(input: { liableFrom?: string | null; bps?: number | string; number?: string }, actor: string): Promise<PlatformVat> {
  const v = cleanPlatformVat(input);
  const old = await getPlatformVat();
  await db().transaction(async (tx) => {
    await tx.insert(platformSettings).values({ key: VAT_KEY, value: v, updatedBy: actor }).onConflictDoUpdate({ target: platformSettings.key, set: { value: v, updatedAt: new Date(), updatedBy: actor } });
    await audit(tx, { hotelId: null, actor, action: "platform.vat_changed", entity: "platform_settings", entityId: VAT_KEY, details: { from: old, to: v } });
  });
  return v;
}
