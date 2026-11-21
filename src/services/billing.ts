import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { hotels, platformCharges, type Hotel } from "../db/schema";
import { todayIn } from "../domain/dates";
import { formatChf } from "../domain/money";
import { getPaymentProvider } from "../payments/provider";
import { enqueueEmail } from "../email/enqueue";
import { env } from "../env";
import { audit } from "./audit";
import { aiBillFor, hotelsWithAiModule } from "./ai-module";
import { monthlyReport } from "./report";
import { shiftMonth } from "./overview";
import { billMonth, invoiceNumber, vatApplies, type PlatformVat } from "../domain/platform-invoice";
import { getPlatformVat } from "./platform-settings";
import { orderFeesForMonth } from "./online-orders";
import { billableSmsCount } from "./sms";

/**
 * Mindestgebühr (Bedingungen für Gastgeber, Ziffer 2): Plattformgebühr (Standard 1,9 %) pro Direktbuchung/Gutschein, mindestens monthly_minimum_rappen
 * pro Kalendermonat. Die Differenz wird Anfang des Folgemonats der hinterlegten Karte belastet (Plattform-Konto).
 */
// ASSUMPTION: Die Mindestgebühr gilt ab dem ersten vollen Kalendermonat nach live_since, auch in Monaten mit Status «paused»;
// Betriebe im Entwurf (nie live) zahlen nichts. Höchstens 3 Belastungsversuche im Abstand von 3 Tagen.

export const MAX_ATTEMPTS = 3;
const RETRY_DAYS = 3;

/** Verdiente Plattformgebühr eines Monats: Buchungen (netto nach Rückerstattung, wie Monatsabrechnung) + bezahlte Gutscheine */
export async function feesForMonth(hotel: Hotel, month: string): Promise<number> {
  const r = await monthlyReport(hotel.id, month);
  const bookingFees = r.lines.filter((l) => l.source === "direct").reduce((s, l) => s + l.net_fee_rappen, 0);
  const [v] = rows<{ fee: number }>(await db().execute(sql`
    SELECT coalesce(sum(v.platform_fee_rappen), 0)::int AS fee FROM vouchers v JOIN hotels h ON h.id = v.hotel_id
     WHERE v.hotel_id = ${hotel.id} AND v.paid_at IS NOT NULL AND to_char(v.paid_at AT TIME ZONE h.timezone, 'YYYY-MM') = ${month}`));
  return bookingFees + v.fee;
}

/** Erster Monat, für den die Mindestgebühr gilt (Monat nach der Live-Schaltung) */
export function firstBilledMonth(hotel: Pick<Hotel, "liveSince" | "timezone">): string | null {
  if (!hotel.liveSince) return null;
  return shiftMonth(todayIn(hotel.timezone, hotel.liveSince).slice(0, 7), 1);
}

/**
 * Abrechnungszeilen für den Vormonat anlegen (idempotent), dann fällige Belastungen ausführen.
 * Betrag = Differenz zur Mindestgebühr + KI-Chat (Modulpreis und Zusatzpakete, SPEC 14b). Eine Belastung pro Monat.
 */
export async function runMonthlyMinimum(now = new Date(), vatOverride?: PlatformVat): Promise<{ created: number; charged: number; failed: number }> {
  const month = shiftMonth(todayIn("Europe/Zurich", now).slice(0, 7), -1);
  const list = await db().select().from(hotels).where(inArray(hotels.status, ["live", "paused"]));
  const aiHotels = new Set(await hotelsWithAiModule());
  const vat = vatOverride ?? await getPlatformVat(); // vatOverride nur für Tests
  const vatOn = vatApplies(vat, month);
  const today = todayIn("Europe/Zurich", now);
  let created = 0;
  for (const h of list) {
    const [exists] = await db().select({ id: platformCharges.id }).from(platformCharges).where(and(eq(platformCharges.hotelId, h.id), eq(platformCharges.month, month)));
    if (exists) continue;
    const first = firstBilledMonth(h);
    const minApplies = h.monthlyMinimumRappen > 0 && !!first && month >= first;
    const ai = aiHotels.has(h.id) ? await aiBillFor(h.id, month) : null;
    const aiTotal = ai?.totalRappen ?? 0;
    const orderFees = await orderFeesForMonth(h, month);
    const fees = (await feesForMonth(h, month)) + orderFees.total;
    const smsRappen = (await billableSmsCount(h.id, month)) * env().SMS_GUEST_PRICE_RAPPEN;
    // Nichts zu verrechnen (kein Minimum, kein KI-Chat, keine Gebühren, keine SMS): keine Rechnung
    if (!minApplies && aiTotal === 0 && fees === 0 && smsRappen === 0) continue;
    const b = billMonth({ feesRappen: fees, minimumRappen: minApplies ? h.monthlyMinimumRappen : 0, aiRappen: aiTotal, vatBps: vatOn ? vat.bps : 0, uncollectedRappen: orderFees.uncollected, smsRappen });
    const [{ n }] = rows<{ n: number }>(await db().execute(sql`SELECT nextval('platform_invoice_seq')::int AS n`));
    const ins = await db().insert(platformCharges).values({
      hotelId: h.id, month, feesRappen: fees, minimumRappen: minApplies ? h.monthlyMinimumRappen : 0, chargeRappen: b.payRappen,
      aiModuleRappen: ai?.moduleRappen ?? 0, aiPacksRappen: ai?.packsRappen ?? 0, uncollectedFeesRappen: orderFees.uncollected, smsRappen, status: b.payRappen > 0 ? "pending" : "none",
      netRappen: b.netRappen, vatBps: vatOn ? vat.bps : 0, vatRappen: b.vatRappen, vatNumber: vatOn ? vat.number : null,
      invoiceNo: invoiceNumber(Number(today.slice(0, 4)), n), invoiceDate: today,
    }).onConflictDoNothing().returning({ id: platformCharges.id });
    created += ins.length;
    // Nichts von der Karte zu belasten: die Rechnung geht trotzdem per Mail (Gebühren sind schon über Stripe einbehalten)
    if (ins.length && b.payRappen === 0) {
      await enqueueEmail(db(), { hotelId: h.id, template: "host_invoice", to: h.contactEmail, language: "de",
        data: { month, invoiceNo: invoiceNumber(Number(today.slice(0, 4)), n), invoiceId: ins[0].id, net: formatChf(b.netRappen), vat: b.vatRappen ? formatChf(b.vatRappen) : "", gross: formatChf(b.grossRappen), withheld: formatChf(b.withheldRappen) } });
    }
  }
  const r = await processCharges(now);
  return { created, ...r };
}

/** Ausstehende und (nach 3 Tagen) fehlgeschlagene Belastungen ausführen */
export async function processCharges(now = new Date()): Promise<{ charged: number; failed: number }> {
  const due = await db().select().from(platformCharges).where(and(
    lt(platformCharges.attempts, MAX_ATTEMPTS),
    sql`(${platformCharges.status} = 'pending' OR (${platformCharges.status} = 'failed' AND ${platformCharges.updatedAt} < ${new Date(now.getTime() - RETRY_DAYS * 864e5).toISOString()}::timestamptz))`,
  ));
  const provider = await getPaymentProvider();
  let charged = 0, failed = 0;
  for (const c of due) {
    const [h] = await db().select().from(hotels).where(eq(hotels.id, c.hotelId));
    const attempt = c.attempts + 1;
    const res = h.billingCustomerId && h.billingPaymentMethodId
      ? await provider.chargeSavedCard({
          hotel: h, customerId: h.billingCustomerId, paymentMethodId: h.billingPaymentMethodId, amountRappen: c.chargeRappen,
          description: `${env().PLATFORM_NAME} Abrechnung ${c.month} – ${h.name}`, receiptEmail: h.contactEmail,
          idempotencyKey: `minimum-${h.id}-${c.month}-${attempt}-${h.billingPaymentMethodId}`,
        })
      : { ok: false as const, paymentIntentId: null, error: "no_card" };
    await db().transaction(async (tx) => {
      await tx.update(platformCharges).set({
        status: res.ok ? "succeeded" : "failed", attempts: attempt, stripePaymentIntentId: res.paymentIntentId,
        error: res.ok ? null : res.error, updatedAt: now,
      }).where(eq(platformCharges.id, c.id));
      await audit(tx, { hotelId: h.id, actor: "system", action: res.ok ? "billing.minimum_charged" : "billing.minimum_failed", entity: "platform_charge", entityId: c.id,
        details: { month: c.month, amount: c.chargeRappen, attempt, error: res.ok ? null : res.error } });
      const shortfall = Math.max(0, c.minimumRappen - c.feesRappen);
      const data = {
        month: c.month, fees: formatChf(c.feesRappen), minimum: formatChf(c.minimumRappen), amount: formatChf(c.chargeRappen), card: h.billingCardLabel ?? "", attempt, last: attempt >= MAX_ATTEMPTS,
        shortfall: shortfall > 0 ? formatChf(shortfall) : "", aiModule: c.aiModuleRappen > 0 ? formatChf(c.aiModuleRappen) : "", aiPacks: c.aiPacksRappen > 0 ? formatChf(c.aiPacksRappen) : "",
        vat: c.vatRappen > 0 ? formatChf(c.vatRappen) : "", invoiceNo: c.invoiceNo ?? "", invoiceId: c.id,
      };
      await enqueueEmail(tx, { hotelId: h.id, template: res.ok ? "host_minimum_charged" : "host_charge_failed", to: h.contactEmail, language: "de", data });
      if (!res.ok && attempt >= MAX_ATTEMPTS && env().PLATFORM_ALERT_EMAIL) {
        await enqueueEmail(tx, { hotelId: h.id, template: "platform_onboarding_alert", to: env().PLATFORM_ALERT_EMAIL!, language: "de",
          data: { hotel: h.name, email: h.contactEmail, propertyType: h.propertyType, openSteps: [`Abrechnung ${c.month} (${formatChf(c.chargeRappen)}) nach ${attempt} Versuchen nicht bezahlt: ${res.error}`], days: 0 } });
      }
    });
    if (res.ok) charged++;
    else failed++;
  }
  return { charged, failed };
}

// ---------------------------------------------------------------- Karte hinterlegen

export async function startCardSetup(hotel: Hotel, returnPath: string): Promise<string> {
  const base = env().APP_BASE_URL;
  const provider = await getPaymentProvider();
  const r = await provider.createCardSetup({
    hotel, email: hotel.contactEmail,
    successUrl: `${base}/mypontivo/${hotel.id}/karte?session_id={CHECKOUT_SESSION_ID}&back=${encodeURIComponent(returnPath)}`,
    cancelUrl: `${base}${returnPath}`,
  });
  return r.url;
}

export async function finishCardSetup(hotel: Hotel, sessionId: string, actor: string) {
  const provider = await getPaymentProvider();
  const r = await provider.finishCardSetup(hotel, sessionId);
  await db().transaction(async (tx) => {
    await tx.update(hotels).set({ billingCustomerId: r.customerId, billingPaymentMethodId: r.paymentMethodId, billingCardLabel: r.label, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
    await audit(tx, { hotelId: hotel.id, actor, action: "billing.card_saved", entity: "hotel", entityId: hotel.id, details: { label: r.label } });
  });
  // Neue Karte: fehlgeschlagene Belastungen gleich nochmals versuchen
  await db().update(platformCharges).set({ status: "pending", updatedAt: new Date() })
    .where(and(eq(platformCharges.hotelId, hotel.id), eq(platformCharges.status, "failed"), lt(platformCharges.attempts, MAX_ATTEMPTS)));
  return r;
}

export async function chargesOf(hotelId: string) {
  return db().select().from(platformCharges).where(eq(platformCharges.hotelId, hotelId)).orderBy(sql`${platformCharges.month} DESC`).limit(24);
}

// ---------------------------------------------------------------- Plattform-Verwaltung

/** Letzte Rechnungen aller Betriebe (Plattform-Verwaltung) */
export async function listPlatformInvoices(limit = 40) {
  return db().select({ c: platformCharges, hotelName: hotels.name }).from(platformCharges)
    .innerJoin(hotels, eq(hotels.id, platformCharges.hotelId))
    .orderBy(sql`${platformCharges.createdAt} DESC`).limit(limit);
}

/** Fehlgeschlagene Belastung nochmals versuchen lassen (der Worker belastet beim nächsten Lauf, spätestens nach einer Minute) */
export async function retryCharge(chargeId: string, actor: string): Promise<boolean> {
  const [c] = await db().select().from(platformCharges).where(eq(platformCharges.id, chargeId));
  if (!c || c.status !== "failed") return false;
  await db().transaction(async (tx) => {
    await tx.update(platformCharges).set({ status: "pending", attempts: 0, updatedAt: new Date() }).where(eq(platformCharges.id, chargeId));
    await audit(tx, { hotelId: c.hotelId, actor, action: "billing.retry", entity: "platform_charge", entityId: chargeId, details: { month: c.month } });
  });
  return true;
}
