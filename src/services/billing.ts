import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { hotels, platformCharges, type Hotel, type PlatformCharge } from "../db/schema";
import { addDays, diffDays, todayIn } from "../domain/dates";
import { formatChf } from "../domain/money";
import { getPaymentProvider } from "../payments/provider";
import { enqueueEmail } from "../email/enqueue";
import { env } from "../env";
import { audit } from "./audit";
import { aiBillFor, hotelsWithAiModule } from "./ai-module";
import { monthlyReport } from "./report";
import { shiftMonth } from "./overview";
import { billMonth, invoiceNumber, REMINDER_DAYS, splitAddress, vatApplies, type PlatformVat } from "../domain/platform-invoice";
import { getPlatformBilling, getPlatformVat } from "./platform-settings";
import { DUNNING_LABEL, matchByReference, nextDunningLevel, parseCamt054 } from "../domain/debtors";
import { isQrIban, qrReference, swissQrPayload } from "../domain/invoice";
import { platformInfo } from "../legal/texts";
import { swissQrSvg } from "./invoicing";
import { orderFeesForMonth, orderModuleFee } from "./online-orders";
import { billableSmsCount } from "./sms";

/**
 * Mindestgebühr (Bedingungen für Gastgeber, Ziffer 2): Plattformgebühr (Standard 1,9 %) pro Direktbuchung/Gutschein, mindestens monthly_minimum_rappen
 * pro Kalendermonat. Die Differenz wird Anfang des Folgemonats der hinterlegten Karte belastet (Plattform-Konto).
 */
// ASSUMPTION: Die Mindestgebühr gilt ab dem ersten vollen Kalendermonat nach live_since, auch in Monaten mit Status «paused»;
// Betriebe im Entwurf (nie live) zahlen nichts. Höchstens 3 Belastungsversuche im Abstand von 3 Tagen.

export const MAX_ATTEMPTS = 3;
const fmtDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
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
  const terms = await getPlatformBilling();
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
    const orderModuleRappen = await orderModuleFee(h, month);
    // Nichts zu verrechnen (kein Minimum, kein KI-Chat, keine Gebühren, keine SMS, keine Pauschale): keine Rechnung
    if (!minApplies && aiTotal === 0 && fees === 0 && smsRappen === 0 && orderModuleRappen === 0) continue;
    const b = billMonth({ feesRappen: fees, minimumRappen: minApplies ? h.monthlyMinimumRappen : 0, aiRappen: aiTotal, vatBps: vatOn ? vat.bps : 0, uncollectedRappen: orderFees.uncollected, smsRappen, orderModuleRappen });
    const [{ n }] = rows<{ n: number }>(await db().execute(sql`SELECT nextval('platform_invoice_seq')::int AS n`));
    // Weg der Zahlung (SPEC 20.6): Karte belasten oder QR-Rechnung mit Fälligkeit
    const qr = h.billingMethod === "qr";
    const due = qr && b.payRappen > 0 ? addDays(today, terms.paymentDays) : null;
    const ins = await db().insert(platformCharges).values({
      hotelId: h.id, month, feesRappen: fees, minimumRappen: minApplies ? h.monthlyMinimumRappen : 0, chargeRappen: b.payRappen,
      aiModuleRappen: ai?.moduleRappen ?? 0, aiPacksRappen: ai?.packsRappen ?? 0, uncollectedFeesRappen: orderFees.uncollected, smsRappen, orderModuleRappen,
      status: b.payRappen > 0 ? (qr ? "invoiced" : "pending") : "none", method: qr ? "qr" : "card", dueDate: due,
      netRappen: b.netRappen, vatBps: vatOn ? vat.bps : 0, vatRappen: b.vatRappen, vatNumber: vatOn ? vat.number : null,
      invoiceNo: invoiceNumber(Number(today.slice(0, 4)), n), invoiceDate: today,
    }).onConflictDoNothing().returning({ id: platformCharges.id });
    created += ins.length;
    if (ins.length && due) {
      await enqueueEmail(db(), { hotelId: h.id, template: "host_invoice_qr", to: h.contactEmail, language: "de",
        data: { month, invoiceNo: invoiceNumber(Number(today.slice(0, 4)), n), invoiceId: ins[0].id, net: formatChf(b.netRappen), vat: b.vatRappen ? formatChf(b.vatRappen) : "", amount: formatChf(b.payRappen), due: fmtDay(due) } });
    }
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
    eq(platformCharges.method, "card"),
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

/** Offene QR-Rechnungen aller Betriebe, älteste Fälligkeit zuerst (Plattform-Verwaltung, SPEC 20.6) */
export async function listOpenQrInvoices() {
  return db().select({ c: platformCharges, hotelName: hotels.name, hotelStatus: hotels.status }).from(platformCharges)
    .innerJoin(hotels, eq(hotels.id, platformCharges.hotelId))
    .where(eq(platformCharges.status, "invoiced")).orderBy(sql`${platformCharges.dueDate} ASC`);
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

// ---------------------------------------------------------------- QR-Rechnung und Mahnwesen (SPEC 20.6)

export class BillingError extends Error {}

/** Zahlungsart der Grundgebühr wählen (Karte oder QR-Rechnung); gilt ab der nächsten Monatsrechnung */
export async function setBillingMethod(hotel: Hotel, method: "card" | "qr", actor: string) {
  if (method !== "card" && method !== "qr") throw new BillingError("Zahlungsart ungültig.");
  await db().transaction(async (tx) => {
    await tx.update(hotels).set({ billingMethod: method, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
    await audit(tx, { hotelId: hotel.id, actor, action: "billing.method", entity: "hotel", entityId: hotel.id, details: { from: hotel.billingMethod, to: method } });
  });
}

/** Zahlteil einer Plattform-Rechnung: QR-Inhalt und SVG, oder Grund, warum er fehlt */
export async function chargeQr(hotel: Hotel, c: PlatformCharge): Promise<{ svg: string; iban: string; reference: string | null; creditor: { name: string; street: string; zip: string; city: string } } | { missing: string } | null> {
  if (c.method !== "qr" || c.status !== "invoiced" || c.chargeRappen <= 0 || !c.invoiceNo) return null;
  const { iban } = await getPlatformBilling();
  const p = platformInfo();
  const addr = splitAddress(p.address);
  if (!iban) return { missing: "Die Zahlungsverbindung der Plattform fehlt noch. Bitte wenden Sie sich an " + p.email + "." };
  if (!addr) return { missing: "Die Adresse der Plattform ist unvollständig." };
  const reference = isQrIban(iban) ? qrReference(c.invoiceNo) : null;
  const creditor = { name: p.operator, ...addr };
  const payload = swissQrPayload({
    iban, qrReference: reference ?? undefined, creditor: { ...creditor, country: "CH" }, amountRappen: c.chargeRappen,
    debtor: hotel.postalCode && hotel.city ? { name: hotel.legalName ?? hotel.name, street: hotel.addressLine ?? "", zip: hotel.postalCode, city: hotel.city, country: "CH" } : null,
    message: `Rechnung ${c.invoiceNo}`,
  });
  return { svg: await swissQrSvg(payload), iban, reference, creditor };
}

/** Zahlung einer QR-Rechnung erfassen (von Hand oder aus der Bankdatei) */
export async function markChargePaid(chargeId: string, p: { paidOn?: string; note?: string; ref?: string | null }, actor: string): Promise<boolean> {
  const at = p.paidOn && /^\d{4}-\d{2}-\d{2}$/.test(p.paidOn) ? new Date(`${p.paidOn}T12:00:00Z`) : new Date();
  return db().transaction(async (tx) => {
    const [c] = await tx.update(platformCharges).set({ status: "succeeded", paidAt: at, paidRef: p.ref ?? null, paidNote: (p.note ?? "").slice(0, 200), updatedAt: new Date() })
      .where(and(eq(platformCharges.id, chargeId), eq(platformCharges.status, "invoiced"))).returning();
    if (!c) return false;
    await audit(tx, { hotelId: c.hotelId, actor, action: "billing.qr_paid", entity: "platform_charge", entityId: c.id, details: { invoiceNo: c.invoiceNo, amount: c.chargeRappen, ref: p.ref ?? null, note: p.note ?? "" } });
    return true;
  });
}

async function sendReminder(c: PlatformCharge, level: 1 | 2 | 3, actor: string, now: Date) {
  const [h] = await db().select().from(hotels).where(eq(hotels.id, c.hotelId));
  const today = todayIn("Europe/Zurich", now);
  await db().transaction(async (tx) => {
    const [u] = await tx.update(platformCharges).set({ dunningLevel: level, dunnedAt: now, updatedAt: now })
      .where(and(eq(platformCharges.id, c.id), eq(platformCharges.status, "invoiced"), lt(platformCharges.dunningLevel, level))).returning({ id: platformCharges.id });
    if (!u) return;
    await audit(tx, { hotelId: c.hotelId, actor, action: "billing.reminder", entity: "platform_charge", entityId: c.id, details: { level, invoiceNo: c.invoiceNo } });
    await enqueueEmail(tx, { hotelId: c.hotelId, template: "host_invoice_reminder", to: h.contactEmail, language: "de",
      data: { level: DUNNING_LABEL[level], invoiceNo: c.invoiceNo ?? "", invoiceId: c.id, month: c.month, amount: formatChf(c.chargeRappen), due: fmtDay(c.dueDate ?? today), newDue: fmtDay(addDays(today, REMINDER_DAYS)), last: level === 3 ? "1" : "" } });
    if (level >= 3 && env().PLATFORM_ALERT_EMAIL) {
      await enqueueEmail(tx, { hotelId: c.hotelId, template: "platform_alert", to: env().PLATFORM_ALERT_EMAIL!, language: "de",
        data: { subject: `${h.name}: Rechnung ${c.invoiceNo} (${formatChf(c.chargeRappen)}) nach der 2. Mahnung offen`, details: `Fällig seit ${fmtDay(c.dueDate ?? today)}. Plattform-Verwaltung → Rechnungen: Zahlung erfassen oder Betrieb pausieren.` } });
    }
  });
}

/** Job täglich: fällige Zahlungserinnerungen und Mahnungen (5, 20, 35 Tage nach Fälligkeit) */
export async function dunningJob(now = new Date()): Promise<{ sent: number }> {
  const today = todayIn("Europe/Zurich", now);
  const open = await db().select().from(platformCharges).where(and(eq(platformCharges.status, "invoiced"), lt(platformCharges.dueDate, today)));
  let sent = 0;
  for (const c of open) {
    const level = nextDunningLevel(diffDays(c.dueDate!, today), c.dunningLevel);
    if (!level) continue;
    await sendReminder(c, level, "system", now);
    sent++;
  }
  return { sent };
}

/** Plattform-Verwaltung: nächste Mahnstufe sofort senden */
export async function remindNow(chargeId: string, actor: string, now = new Date()): Promise<number | null> {
  const [c] = await db().select().from(platformCharges).where(eq(platformCharges.id, chargeId));
  if (!c || c.status !== "invoiced" || c.dunningLevel >= 3) return null;
  const level = (c.dunningLevel + 1) as 1 | 2 | 3;
  await sendReminder(c, level, actor, now);
  return level;
}

/** Plattform-Verwaltung: Rechnung erneut per Mail senden */
export async function resendQrInvoice(chargeId: string, actor: string): Promise<boolean> {
  const [c] = await db().select().from(platformCharges).where(eq(platformCharges.id, chargeId));
  if (!c || c.status !== "invoiced" || !c.invoiceNo || !c.dueDate) return false;
  const [h] = await db().select().from(hotels).where(eq(hotels.id, c.hotelId));
  await db().transaction(async (tx) => {
    await enqueueEmail(tx, { hotelId: h.id, template: "host_invoice_qr", to: h.contactEmail, language: "de",
      data: { month: c.month, invoiceNo: c.invoiceNo!, invoiceId: c.id, net: formatChf(c.netRappen), vat: c.vatRappen ? formatChf(c.vatRappen) : "", amount: formatChf(c.chargeRappen), due: fmtDay(c.dueDate!) } });
    await audit(tx, { hotelId: h.id, actor, action: "billing.invoice_resent", entity: "platform_charge", entityId: c.id });
  });
  return true;
}

export type PlatformBankResult = { entries: number; matched: { invoiceNo: string; amountRappen: number }[]; unmatched: { bookedOn: string; amountRappen: number; reference: string; why: string }[]; duplicates: number };

/** Bankdatei camt.054 der Plattform: Gutschriften über die QR-Referenz den offenen QR-Rechnungen zuordnen */
export async function importPlatformCamt(xml: string, actor: string): Promise<PlatformBankResult> {
  const entries = parseCamt054(xml);
  const open = await db().select().from(platformCharges).where(eq(platformCharges.status, "invoiced"));
  const res: PlatformBankResult = { entries: entries.length, matched: [], unmatched: [], duplicates: 0 };
  for (const e of entries) {
    const [dup] = await db().select({ id: platformCharges.id }).from(platformCharges).where(eq(platformCharges.paidRef, e.dedupeKey));
    if (dup) { res.duplicates++; continue; }
    const c = matchByReference(e.reference, open.map((x) => ({ ...x, number: x.invoiceNo })));
    if (!c) { res.unmatched.push({ ...e, why: "keine offene Rechnung mit dieser Referenz" }); continue; }
    if (e.amountRappen < c.chargeRappen) { res.unmatched.push({ ...e, why: `Betrag kleiner als ${formatChf(c.chargeRappen)} (${c.invoiceNo})` }); continue; }
    if (await markChargePaid(c.id, { paidOn: e.bookedOn, ref: e.dedupeKey, note: "Bankdatei" }, actor)) res.matched.push({ invoiceNo: c.invoiceNo!, amountRappen: e.amountRappen });
  }
  return res;
}
