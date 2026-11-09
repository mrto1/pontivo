import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { hotels, voucherRedemptions, vouchers, type Hotel, type Voucher } from "../db/schema";
import { addDays, todayIn } from "../domain/dates";
import { platformFee } from "../domain/pricing";
import { formatChf } from "../domain/money";
import { newPublicToken } from "../domain/ids";
import { isLocale, t, type Locale } from "../i18n/dict";
import { enqueueEmail } from "../email/enqueue";
import { getPaymentProvider } from "../payments/provider";
import { env } from "../env";
import { isBookable } from "./hotels";
import { audit } from "./audit";
import crypto from "node:crypto";

/**
 * Wertgutscheine (Pontivo Web): Gast kauft online (Direct Charge aufs Hotelkonto, 1 % Plattformgebühr),
 * bekommt Code und Druckansicht per Mail, das Hotel löst im Admin ein – auch in Teilbeträgen.
 */
// ASSUMPTION: v1 ohne Einlösung bei der Online-Buchung; Gültigkeit Standard 3 Jahre (rechtlich prüfen lassen).

export class VoucherError extends Error {}

export type VoucherSettings = { enabled: boolean; amounts: number[]; minRappen: number; maxRappen: number; validityYears: number };
export const DEFAULT_VOUCHERS: VoucherSettings = { enabled: false, amounts: [5000, 10000, 20000], minRappen: 2000, maxRappen: 100000, validityYears: 3 };

export function voucherSettings(hotel: Hotel): VoucherSettings {
  return { ...DEFAULT_VOUCHERS, ...(hotel.content.vouchers ?? {}) };
}

/** Gutscheine online verkaufen? Eingeschaltet und Zahlung beim Hotel eingerichtet */
export function vouchersAvailable(hotel: Hotel): boolean {
  return voucherSettings(hotel).enabled && isBookable(hotel, env().PAYMENT_PROVIDER);
}

export const voucherSettingsSchema = z.object({
  enabled: z.boolean(),
  amounts: z.array(z.number().int().min(1000).max(500000)).min(1).max(6),
  minRappen: z.number().int().min(1000).max(500000),
  maxRappen: z.number().int().min(1000).max(500000),
  validityYears: z.number().int().min(1).max(10),
}).refine((v) => v.minRappen <= v.maxRappen, { message: "Mindestbetrag grösser als Höchstbetrag", path: ["minRappen"] });

export async function updateVoucherSettings(hotelId: string, input: z.input<typeof voucherSettingsSchema>, actor: string) {
  const v = voucherSettingsSchema.parse(input);
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotelId));
  await db().update(hotels).set({ content: { ...h.content, vouchers: v }, updatedAt: new Date() }).where(eq(hotels.id, hotelId));
  await audit(db(), { hotelId, actor, action: "voucher.settings", entity: "hotel", entityId: hotelId, details: v });
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** GS-XXXX-XXXX, gut am Telefon diktierbar */
export function newVoucherCode(): string {
  const b = crypto.randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return `GS-${s.slice(0, 4)}-${s.slice(4)}`;
}

export const buyVoucherSchema = z.object({
  amountRappen: z.number().int(),
  buyerName: z.string().trim().min(1).max(120),
  buyerEmail: z.string().trim().email().max(200),
  recipientName: z.string().trim().max(120).default(""),
  message: z.string().trim().max(500).default(""),
  language: z.string().refine(isLocale).default("de"),
});

/** Gutschein anlegen (ausstehend) und zur Zahlung weiterleiten. Fake-Zahlung: sofort bezahlt. */
export async function buyVoucher(hotel: Hotel, input: z.input<typeof buyVoucherSchema>): Promise<{ voucher: Voucher; checkoutUrl: string }> {
  if (!vouchersAvailable(hotel)) throw new VoucherError("not_available");
  const v = buyVoucherSchema.parse(input);
  const set = voucherSettings(hotel);
  if (v.amountRappen < set.minRappen || v.amountRappen > set.maxRappen) throw new VoucherError("amount");
  const lang = v.language as Locale;
  const today = todayIn(hotel.timezone);
  const validUntil = addDays(today, Math.round(365.25 * set.validityYears));
  const fee = platformFee(v.amountRappen, hotel.platformFeeBps);
  const [voucher] = await db().insert(vouchers).values({
    hotelId: hotel.id, code: newVoucherCode(), publicToken: newPublicToken(), amountRappen: v.amountRappen, remainingRappen: v.amountRappen,
    platformFeeRappen: fee, buyerName: v.buyerName, buyerEmail: v.buyerEmail, recipientName: v.recipientName, message: v.message, language: lang, validUntil,
  }).returning();
  const provider = await getPaymentProvider();
  const base = env().APP_BASE_URL;
  const checkout = await provider.createPaymentCheckout({
    hotel, amountRappen: v.amountRappen, feeRappen: fee, email: v.buyerEmail, lang,
    description: `${t(lang).vTitle} ${hotel.name} – ${formatChf(v.amountRappen)}`,
    successUrl: `${base}/v/${voucher.publicToken}?paid=1`, cancelUrl: `${base}/v/${voucher.publicToken}?cancelled=1`,
    metadata: { voucher_id: voucher.id }, reference: voucher.code, idempotencyKey: `voucher-${voucher.id}`,
  });
  await db().update(vouchers).set({ stripeSessionId: checkout.sessionId }).where(eq(vouchers.id, voucher.id));
  if (provider.confirmsImmediately) await markVoucherPaid(voucher.id, { sessionId: checkout.sessionId, paymentIntentId: null });
  return { voucher, checkoutUrl: checkout.url };
}

/** Zahlung bestätigt (Webhook oder Fake) – idempotent */
export async function markVoucherPaid(voucherId: string, p: { sessionId: string | null; paymentIntentId: string | null }) {
  await db().transaction(async (tx) => {
    const [v] = await tx.select().from(vouchers).where(eq(vouchers.id, voucherId)).for("update");
    if (!v || v.status === "paid") return;
    await tx.update(vouchers).set({ status: "paid", paidAt: new Date(), stripePaymentIntentId: p.paymentIntentId, stripeSessionId: p.sessionId ?? v.stripeSessionId }).where(eq(vouchers.id, v.id));
    const [h] = await tx.select().from(hotels).where(eq(hotels.id, v.hotelId));
    const data = { voucherId: v.id, code: v.code, amountRappen: v.amountRappen, validUntil: v.validUntil, token: v.publicToken, buyer: v.buyerName, recipient: v.recipientName };
    await enqueueEmail(tx, { hotelId: v.hotelId, template: "voucher_purchased", to: v.buyerEmail, language: v.language, data });
    await enqueueEmail(tx, { hotelId: v.hotelId, template: "hotel_voucher_sold", to: h.contactEmail, language: h.defaultLanguage, data });
    await audit(tx, { hotelId: v.hotelId, actor: "payment", action: "voucher.paid", entity: "voucher", entityId: v.id, details: { amount: v.amountRappen } });
  });
}

/** Zahlung abgebrochen oder abgelaufen: ausstehender Gutschein wird nie gültig */
export async function cancelPendingVoucher(voucherId: string) {
  await db().update(vouchers).set({ status: "cancelled" }).where(and(eq(vouchers.id, voucherId), eq(vouchers.status, "pending")));
}

export async function voucherByToken(token: string) {
  const [v] = await db().select().from(vouchers).where(eq(vouchers.publicToken, token));
  return v ?? null;
}

export async function listVouchers(hotelId: string, q?: string) {
  const code = q?.trim().toUpperCase();
  return db().select().from(vouchers)
    .where(and(eq(vouchers.hotelId, hotelId), sql`${vouchers.status} <> 'cancelled'`, code ? sql`${vouchers.code} = ${code} OR ${vouchers.buyerName} ILIKE ${"%" + q!.trim() + "%"}` : sql`true`))
    .orderBy(desc(vouchers.createdAt)).limit(200);
}

export async function redemptionsOf(hotelId: string, voucherId: string) {
  return db().select().from(voucherRedemptions).where(and(eq(voucherRedemptions.hotelId, hotelId), eq(voucherRedemptions.voucherId, voucherId))).orderBy(desc(voucherRedemptions.createdAt));
}

/** Im Hotel einlösen (ganz oder teilweise). Nur bezahlte, gültige Gutscheine dieses Hotels. */
export async function redeemVoucher(hotel: Hotel, code: string, amountRappen: number, note: string, actor: string, now = new Date()) {
  if (!Number.isInteger(amountRappen) || amountRappen <= 0) throw new VoucherError("Betrag fehlt");
  return db().transaction(async (tx) => {
    const [v] = await tx.select().from(vouchers).where(and(eq(vouchers.hotelId, hotel.id), eq(vouchers.code, code.trim().toUpperCase()))).for("update");
    if (!v || v.status !== "paid") throw new VoucherError("Gutschein nicht gefunden oder nicht bezahlt");
    if (v.validUntil < todayIn(hotel.timezone, now)) throw new VoucherError(`Gutschein abgelaufen am ${v.validUntil}`);
    if (amountRappen > v.remainingRappen) throw new VoucherError(`Restwert nur ${formatChf(v.remainingRappen)}`);
    await tx.update(vouchers).set({ remainingRappen: v.remainingRappen - amountRappen }).where(eq(vouchers.id, v.id));
    await tx.insert(voucherRedemptions).values({ voucherId: v.id, hotelId: hotel.id, amountRappen, note: note.slice(0, 200), actor });
    await audit(tx, { hotelId: hotel.id, actor, action: "voucher.redeem", entity: "voucher", entityId: v.id, details: { amountRappen } });
    return { ...v, remainingRappen: v.remainingRappen - amountRappen };
  });
}

// ---------------------------------------------------------------- Einlösen bei der Online-Buchung

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * Gutschein für eine Reservierung sperren und anrechnen (in der Hold-Transaktion).
 * Angerechnet wird höchstens der Restwert. Gültig ist der Gutschein, wenn er am Buchungstag nicht abgelaufen ist.
 */
export async function takeVoucherForBooking(tx: Tx, hotel: Hotel, code: string, totalRappen: number, today: string): Promise<{ voucher: Voucher; amountRappen: number }> {
  const [v] = await tx.select().from(vouchers).where(and(eq(vouchers.hotelId, hotel.id), eq(vouchers.code, code.trim().toUpperCase()))).for("update");
  if (!v || v.status !== "paid") throw new VoucherError("voucher_invalid");
  if (v.validUntil < today) throw new VoucherError("voucher_expired");
  if (v.remainingRappen <= 0) throw new VoucherError("voucher_empty");
  return { voucher: v, amountRappen: Math.min(v.remainingRappen, totalRappen) };
}

/** Betrag vom Gutschein abziehen und als Einlösung zur Buchung festhalten */
export async function chargeVoucher(tx: Tx, v: { id: string; hotelId: string }, bookingId: string, amountRappen: number, note: string, actor: string) {
  const r = await tx.execute(sql`UPDATE vouchers SET remaining_rappen = remaining_rappen - ${amountRappen} WHERE id = ${v.id} AND remaining_rappen >= ${amountRappen} AND status = 'paid' RETURNING id`);
  if (!r.rows.length) throw new VoucherError("voucher_empty");
  await tx.insert(voucherRedemptions).values({ voucherId: v.id, hotelId: v.hotelId, bookingId, amountRappen, note, actor });
}

/** Betrag wieder auf den Gutschein gutschreiben (Reservierung abgelaufen, Buchung storniert) */
export async function creditVoucher(tx: Tx, voucherId: string, hotelId: string, bookingId: string, amountRappen: number, note: string, actor: string) {
  if (amountRappen <= 0) return;
  await tx.execute(sql`UPDATE vouchers SET remaining_rappen = LEAST(amount_rappen, remaining_rappen + ${amountRappen}) WHERE id = ${voucherId}`);
  await tx.insert(voucherRedemptions).values({ voucherId, hotelId, bookingId, amountRappen: -amountRappen, note, actor });
}
