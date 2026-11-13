import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { hotels, platformCharges, type Hotel } from "../db/schema";
import { todayIn } from "../domain/dates";
import { formatChf } from "../domain/money";
import { getPaymentProvider } from "../payments/provider";
import { enqueueEmail } from "../email/enqueue";
import { env } from "../env";
import { audit } from "./audit";
import { monthlyReport } from "./report";
import { shiftMonth } from "./overview";

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

/** Abrechnungszeilen für den Vormonat anlegen (idempotent), dann fällige Belastungen ausführen */
export async function runMonthlyMinimum(now = new Date()): Promise<{ created: number; charged: number; failed: number }> {
  const month = shiftMonth(todayIn("Europe/Zurich", now).slice(0, 7), -1);
  const list = await db().select().from(hotels).where(and(sql`${hotels.monthlyMinimumRappen} > 0`, inArray(hotels.status, ["live", "paused"])));
  let created = 0;
  for (const h of list) {
    const first = firstBilledMonth(h);
    if (!first || month < first) continue;
    const fees = await feesForMonth(h, month);
    const charge = Math.max(0, h.monthlyMinimumRappen - fees);
    const ins = await db().insert(platformCharges).values({
      hotelId: h.id, month, feesRappen: fees, minimumRappen: h.monthlyMinimumRappen, chargeRappen: charge, status: charge > 0 ? "pending" : "none",
    }).onConflictDoNothing().returning({ id: platformCharges.id });
    created += ins.length;
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
          description: `${env().PLATFORM_NAME} Mindestgebühr ${c.month} – ${h.name}`, receiptEmail: h.contactEmail,
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
      const data = { month: c.month, fees: formatChf(c.feesRappen), minimum: formatChf(c.minimumRappen), amount: formatChf(c.chargeRappen), card: h.billingCardLabel ?? "", attempt, last: attempt >= MAX_ATTEMPTS };
      await enqueueEmail(tx, { hotelId: h.id, template: res.ok ? "host_minimum_charged" : "host_charge_failed", to: h.contactEmail, language: "de", data });
      if (!res.ok && attempt >= MAX_ATTEMPTS && env().PLATFORM_ALERT_EMAIL) {
        await enqueueEmail(tx, { hotelId: h.id, template: "platform_onboarding_alert", to: env().PLATFORM_ALERT_EMAIL!, language: "de",
          data: { hotel: h.name, email: h.contactEmail, propertyType: h.propertyType, openSteps: [`Mindestgebühr ${c.month} (${formatChf(c.chargeRappen)}) nach ${attempt} Versuchen nicht bezahlt: ${res.error}`], days: 0 } });
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
    successUrl: `${base}/admin/${hotel.id}/karte?session_id={CHECKOUT_SESSION_ID}&back=${encodeURIComponent(returnPath)}`,
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
