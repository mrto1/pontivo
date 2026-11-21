import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { platformSettings } from "../db/schema";
import { DEFAULT_PLATFORM_BILLING, DEFAULT_PLATFORM_VAT, cleanPlatformVat, type OrderFeeModel, type PlatformBilling, type PlatformVat } from "../domain/platform-invoice";
import { cleanIban, isSwissIban } from "../domain/invoice";
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

const BILLING_KEY = "billing";

/** Zahlungsverbindung der Plattform für QR-Rechnungen (SPEC 20.6) */
export async function getPlatformBilling(): Promise<PlatformBilling> {
  const [r] = await db().select().from(platformSettings).where(eq(platformSettings.key, BILLING_KEY));
  const v = ((r?.value && typeof r.value === "object" ? r.value : {}) as Partial<PlatformBilling>);
  return { iban: typeof v.iban === "string" ? v.iban : DEFAULT_PLATFORM_BILLING.iban, paymentDays: typeof v.paymentDays === "number" ? v.paymentDays : DEFAULT_PLATFORM_BILLING.paymentDays };
}

export class PlatformSettingsError extends Error {}

export async function savePlatformBilling(input: { iban: string; paymentDays: number }, actor: string): Promise<PlatformBilling> {
  const iban = cleanIban(input.iban);
  if (iban && !isSwissIban(iban)) throw new PlatformSettingsError("IBAN ungültig: Schweizer oder liechtensteinische IBAN (CH/LI, 21 Zeichen) mit gültiger Prüfziffer.");
  if (!Number.isInteger(input.paymentDays) || input.paymentDays < 5 || input.paymentDays > 90) throw new PlatformSettingsError("Zahlungsfrist: 5 bis 90 Tage.");
  const v: PlatformBilling = { iban, paymentDays: input.paymentDays };
  const old = await getPlatformBilling();
  await db().transaction(async (tx) => {
    await tx.insert(platformSettings).values({ key: BILLING_KEY, value: v, updatedBy: actor }).onConflictDoUpdate({ target: platformSettings.key, set: { value: v, updatedAt: new Date(), updatedBy: actor } });
    await audit(tx, { hotelId: null, actor, action: "platform.billing_changed", entity: "platform_settings", entityId: BILLING_KEY, details: { from: old, to: v } });
  });
  return v;
}

const RESTAURANT_KEY = "restaurant_public";

/** Restaurant-Seite öffentlich (SPEC 20.9): verlinkt auf der Startseite, in der Registrierung wählbar. Standard aus (Konzept Entscheid 1). */
export async function restaurantPublic(): Promise<boolean> {
  const [r] = await db().select().from(platformSettings).where(eq(platformSettings.key, RESTAURANT_KEY));
  return r?.value === true;
}

export async function setRestaurantPublic(on: boolean, actor: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.insert(platformSettings).values({ key: RESTAURANT_KEY, value: on, updatedBy: actor }).onConflictDoUpdate({ target: platformSettings.key, set: { value: on, updatedAt: new Date(), updatedBy: actor } });
    await audit(tx, { hotelId: null, actor, action: "platform.restaurant_public", entity: "platform_settings", entityId: RESTAURANT_KEY, details: { on } });
  });
}

const ORDER_FEE_KEY = "order_fee_model";

/** Preismodell der Online-Bestellung (SPEC 20.4). Standard «fixed» (CHF 59/Monat), bis die ESTV die Plattformfrage positiv beantwortet. */
export async function orderFeeModel(): Promise<OrderFeeModel> {
  const [r] = await db().select().from(platformSettings).where(eq(platformSettings.key, ORDER_FEE_KEY));
  return r?.value === "percent" ? "percent" : "fixed";
}

export async function setOrderFeeModel(model: OrderFeeModel, actor: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.insert(platformSettings).values({ key: ORDER_FEE_KEY, value: model, updatedBy: actor }).onConflictDoUpdate({ target: platformSettings.key, set: { value: model, updatedAt: new Date(), updatedBy: actor } });
    await audit(tx, { hotelId: null, actor, action: "platform.order_fee_model", entity: "platform_settings", entityId: ORDER_FEE_KEY, details: { model } });
  });
}
