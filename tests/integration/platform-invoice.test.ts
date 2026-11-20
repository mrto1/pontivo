import { afterAll, afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { auditLog, bookings, emailOutbox, hotels, platformCharges } from "../../src/db/schema";
import { registerHost } from "../../src/services/onboarding";
import { processCharges, retryCharge, runMonthlyMinimum } from "../../src/services/billing";
import { getPlatformVat, savePlatformVat } from "../../src/services/platform-settings";
import { shiftMonth } from "../../src/services/overview";
import { setPaymentProvider, type PaymentProvider } from "../../src/payments/provider";
import { FakePaymentProvider } from "../../src/payments/fake";
import { render } from "../../src/email/templates";
import { todayIn } from "../../src/domain/dates";
import { uid } from "../helpers";

afterAll(closeDb);
afterEach(() => setPaymentProvider(null));

const fresh = async (id: string) => (await db().select().from(hotels).where(eq(hotels.id, id)))[0];
const mails = (hotelId: string, template: string) => db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, hotelId), eq(emailOutbox.template, template)));
const lastMonth = () => shiftMonth(todayIn("Europe/Zurich").slice(0, 7), -1);
const chargeOf = async (hotelId: string) => (await db().select().from(platformCharges).where(eq(platformCharges.hotelId, hotelId)))[0];

async function liveHost(o: { min?: number; fees?: number } = {}) {
  const { hotel } = await registerHost({ propertyType: "apartment", name: `Chalet ${uid()}`, contactName: "Ruth Keller", email: `host-${uid()}@example.ch`, canton: "GR", municipality: `Testdorf-${uid()}`, acceptTerms: true } as never);
  await db().update(hotels).set({
    status: "live", liveSince: new Date(Date.now() - 120 * 864e5), monthlyMinimumRappen: o.min ?? 1900,
    billingCustomerId: `fake_cus_${hotel.id}`, billingPaymentMethodId: `fake_pm_${hotel.id}`, billingCardLabel: "Testkarte •••• 4242",
  }).where(eq(hotels.id, hotel.id));
  if (o.fees) {
    const [y, m] = lastMonth().split("-").map(Number);
    await db().insert(bookings).values({ hotelId: hotel.id, reference: `T-${uid()}`, publicToken: uid() + uid(), source: "direct", status: "confirmed",
      checkin: "2026-01-10", checkout: "2026-01-12", adults: 2, totalRappen: o.fees * 100, roomsTotalRappen: o.fees * 100, platformFeeRappen: o.fees, confirmedAt: new Date(Date.UTC(y, m - 1, 15, 10)) });
  }
  return fresh(hotel.id);
}

const NO_VAT = { liableFrom: null, bps: 810, number: "" };
const VAT = { liableFrom: `${lastMonth()}-01`, bps: 810, number: "CHE-123.456.789 MWST" };

describe("Rechnung an das Hotel", () => {
  it("ohne MWST: Nummer, Datum, Betrag der Differenz; Mail mit Link; zweiter Lauf ändert nichts", async () => {
    const fake = new FakePaymentProvider();
    setPaymentProvider(fake);
    const h = await liveHost({ fees: 500 });
    await runMonthlyMinimum(new Date(), NO_VAT);
    const c = await chargeOf(h.id);
    expect(c).toMatchObject({ month: lastMonth(), feesRappen: 500, netRappen: 1900, vatBps: 0, vatRappen: 0, chargeRappen: 1400, status: "succeeded", invoiceDate: todayIn("Europe/Zurich"), vatNumber: null });
    expect(c.invoiceNo).toMatch(/^R-\d{4}-\d{5}$/);
    const mail = (await mails(h.id, "host_minimum_charged"))[0];
    expect(mail.data).toMatchObject({ invoiceNo: c.invoiceNo, invoiceId: c.id });
    const r = render("host_minimum_charged", "de", { hotel: h, data: mail.data as Record<string, unknown>, baseUrl: "https://x" });
    expect(r.text).toContain(`/mypontivo/${h.id}/plattform-rechnung/${c.id}`);
    await runMonthlyMinimum(new Date(), NO_VAT);
    expect((await chargeOf(h.id)).invoiceNo).toBe(c.invoiceNo);
  });

  it("mit MWST-Pflicht: MWST obendrauf, auch wenn die Gebühren das Minimum schon decken", async () => {
    const fake = new FakePaymentProvider();
    setPaymentProvider(fake);
    const over = await liveHost({ fees: 2500 });
    const under = await liveHost({ fees: 500 });
    await runMonthlyMinimum(new Date(), VAT);
    expect(await chargeOf(over.id)).toMatchObject({ feesRappen: 2500, netRappen: 2500, vatBps: 810, vatRappen: 203, chargeRappen: 203, status: "succeeded", vatNumber: VAT.number });
    expect(fake.charges.find((x) => x.hotel.id === over.id)!.amountRappen).toBe(203);
    // Differenz 1400 + MWST auf 1900 (154)
    expect(await chargeOf(under.id)).toMatchObject({ netRappen: 1900, vatRappen: 154, chargeRappen: 1400 + 154 });
    expect(fake.charges.find((x) => x.hotel.id === under.id)!.amountRappen).toBe(1554);
    const mail = (await mails(under.id, "host_minimum_charged"))[0];
    expect(render("host_minimum_charged", "de", { hotel: under, data: mail.data as Record<string, unknown>, baseUrl: "https://x" }).text).toContain("Mehrwertsteuer");
  });

  it("MWST-Pflicht beginnt erst nach dem Abrechnungsmonat: Monat davor ohne MWST", async () => {
    setPaymentProvider(new FakePaymentProvider());
    const h = await liveHost({ fees: 500 });
    await runMonthlyMinimum(new Date(), { ...VAT, liableFrom: todayIn("Europe/Zurich") }); // heute: Vormonat noch ohne
    expect(await chargeOf(h.id)).toMatchObject({ vatBps: 0, vatRappen: 0, chargeRappen: 1400 });
  });

  it("nur Gebühren, nichts zu belasten: Rechnung wird trotzdem ausgestellt und per Mail geschickt", async () => {
    setPaymentProvider(new FakePaymentProvider());
    const h = await liveHost({ min: 0, fees: 1000 });
    await runMonthlyMinimum(new Date(), NO_VAT);
    const c = await chargeOf(h.id);
    expect(c).toMatchObject({ netRappen: 1000, chargeRappen: 0, status: "none" });
    expect(c.invoiceNo).toBeTruthy();
    const m = await mails(h.id, "host_invoice");
    expect(m).toHaveLength(1);
    expect(render("host_invoice", "de", { hotel: h, data: m[0].data as Record<string, unknown>, baseUrl: "https://x" }).text).toContain("nichts mehr zu bezahlen");
  });

  it("nichts zu verrechnen: keine Rechnung; Nummern sind eindeutig", async () => {
    setPaymentProvider(new FakePaymentProvider());
    const none = await liveHost({ min: 0 });
    const a = await liveHost({ fees: 500 });
    const b = await liveHost({ fees: 500 });
    await runMonthlyMinimum(new Date(), NO_VAT);
    expect(await chargeOf(none.id)).toBeUndefined();
    expect((await chargeOf(a.id)).invoiceNo).not.toBe((await chargeOf(b.id)).invoiceNo);
  });

  it("fehlgeschlagene Belastung: «Erneut versuchen» setzt die Versuche zurück", async () => {
    let ok = false;
    const flaky: PaymentProvider = Object.assign(new FakePaymentProvider(), {
      async chargeSavedCard(a: { idempotencyKey: string }) { return ok ? { ok: true as const, paymentIntentId: `pi_${a.idempotencyKey}` } : { ok: false as const, paymentIntentId: null, error: "card_declined" }; },
    });
    setPaymentProvider(flaky);
    const h = await liveHost({ fees: 500 });
    await runMonthlyMinimum(new Date(), NO_VAT);
    expect(await chargeOf(h.id)).toMatchObject({ status: "failed", attempts: 1 });
    expect(await retryCharge("00000000-0000-0000-0000-000000000000", "t")).toBe(false);
    ok = true;
    expect(await retryCharge((await chargeOf(h.id)).id, "t")).toBe(true);
    await processCharges();
    expect(await chargeOf(h.id)).toMatchObject({ status: "succeeded", attempts: 1 });
    const logs = await db().select().from(auditLog).where(and(eq(auditLog.hotelId, h.id), eq(auditLog.action, "billing.retry")));
    expect(logs).toHaveLength(1);
  });
});

describe("MWST-Schalter", () => {
  it("speichern, lesen, ausschalten, prüfen und protokollieren", async () => {
    const before = await getPlatformVat();
    try {
      await expect(savePlatformVat({ liableFrom: "2027-01-01", bps: 810, number: "" }, "t")).rejects.toThrow(/MWST-Nummer/);
      expect(await savePlatformVat({ liableFrom: "2027-01-01", bps: 810, number: "CHE-123.456.789 MWST" }, "t")).toMatchObject({ liableFrom: "2027-01-01" });
      expect(await getPlatformVat()).toEqual({ liableFrom: "2027-01-01", bps: 810, number: "CHE-123.456.789 MWST" });
      await savePlatformVat({ liableFrom: null, bps: 810, number: "" }, "t");
      expect((await getPlatformVat()).liableFrom).toBeNull();
      const logs = await db().select().from(auditLog).where(eq(auditLog.action, "platform.vat_changed"));
      expect(logs.length).toBeGreaterThanOrEqual(2);
    } finally {
      await savePlatformVat({ liableFrom: before.liableFrom, bps: before.bps, number: before.number }, "t-restore").catch(() => {});
    }
  });
});
