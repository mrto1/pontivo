import { afterAll, afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { emailOutbox, hotels, platformCharges } from "../../src/db/schema";
import { registerHost } from "../../src/services/onboarding";
import { chargeQr, dunningJob, importPlatformCamt, markChargePaid, processCharges, remindNow, runMonthlyMinimum, setBillingMethod } from "../../src/services/billing";
import { getPlatformBilling, savePlatformBilling } from "../../src/services/platform-settings";
import { shiftMonth } from "../../src/services/overview";
import { setPaymentProvider } from "../../src/payments/provider";
import { FakePaymentProvider } from "../../src/payments/fake";
import { render } from "../../src/email/templates";
import { addDays, todayIn } from "../../src/domain/dates";
import { qrReference } from "../../src/domain/invoice";
import { billingReady } from "../../src/domain/platform-invoice";
import { uid } from "../helpers";

afterAll(closeDb);
afterEach(() => setPaymentProvider(null));

const NO_VAT = { liableFrom: null, bps: 810, number: "" };
const QR_IBAN = "CH4431999123000889012";
const fresh = async (id: string) => (await db().select().from(hotels).where(eq(hotels.id, id)))[0];
const mails = (hotelId: string, template: string) => db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, hotelId), eq(emailOutbox.template, template)));
const chargeOf = async (hotelId: string) => (await db().select().from(platformCharges).where(eq(platformCharges.hotelId, hotelId)))[0];

async function qrHost() {
  const { hotel } = await registerHost({ propertyType: "apartment", name: `Chalet ${uid()}`, contactName: "Ruth Keller", email: `host-${uid()}@example.ch`, canton: "GR", municipality: `Testdorf-${uid()}`, acceptTerms: true } as never);
  await db().update(hotels).set({ status: "live", liveSince: new Date(Date.now() - 120 * 864e5), monthlyMinimumRappen: 1900, addressLine: "Dorfstrasse 3", postalCode: "7270", city: "Davos" }).where(eq(hotels.id, hotel.id));
  let h = await fresh(hotel.id);
  expect(billingReady(h)).toBe(false);
  await setBillingMethod(h, "qr", "t");
  h = await fresh(hotel.id);
  expect(billingReady(h)).toBe(true);
  return h;
}

describe("Grundgebühr per QR-Rechnung (SPEC 20.6)", () => {
  it("Monatsrechnung mit Fälligkeit, Mail, Zahlteil mit QR-Referenz; Karte wird nicht belastet; Zahlung erfassen", async () => {
    const fake = new FakePaymentProvider();
    setPaymentProvider(fake);
    await savePlatformBilling({ iban: "CH44 3199 9123 0008 8901 2", paymentDays: 30 }, "t");
    const h = await qrHost();
    await runMonthlyMinimum(new Date(), NO_VAT);
    const c = await chargeOf(h.id);
    const today = todayIn("Europe/Zurich");
    expect(c).toMatchObject({ method: "qr", status: "invoiced", chargeRappen: 1900, dueDate: addDays(today, 30), dunningLevel: 0 });
    await processCharges();
    expect((await chargeOf(h.id)).status).toBe("invoiced");
    const mail = (await mails(h.id, "host_invoice_qr"))[0];
    const r = render("host_invoice_qr", "de", { hotel: h, data: mail.data as Record<string, unknown>, baseUrl: "https://x" });
    expect(r.text).toContain("CHF 19.00");
    expect(r.text).toContain(`/plattform-rechnung/${c.id}`);
    const qr = await chargeQr(h, c);
    expect(qr && "svg" in qr && qr.reference).toBe(qrReference(c.invoiceNo!));
    expect(qr && "svg" in qr && qr.creditor.zip).toMatch(/^\d{4}$/);
    expect(await markChargePaid(c.id, { paidOn: today, note: "E-Banking" }, "t")).toBe(true);
    expect(await markChargePaid(c.id, {}, "t")).toBe(false);
    expect((await chargeOf(h.id))).toMatchObject({ status: "succeeded", paidNote: "E-Banking" });
  });

  it("Mahnwesen: Erinnerung 5, 1. Mahnung 20, 2. Mahnung 35 Tage nach Fälligkeit; letzte mit Hinweis an die Plattform", async () => {
    setPaymentProvider(new FakePaymentProvider());
    const h = await qrHost();
    await runMonthlyMinimum(new Date(), NO_VAT);
    const c = await chargeOf(h.id);
    const at = (days: number) => new Date(Date.parse(`${addDays(c.dueDate!, days)}T09:00:00Z`));
    await dunningJob(at(3));
    expect((await chargeOf(h.id)).dunningLevel).toBe(0);
    await dunningJob(at(5));
    expect((await chargeOf(h.id)).dunningLevel).toBe(1);
    await dunningJob(at(6));
    expect((await mails(h.id, "host_invoice_reminder"))).toHaveLength(1);
    await dunningJob(at(20));
    await dunningJob(at(35));
    expect((await chargeOf(h.id)).dunningLevel).toBe(3);
    const list = await mails(h.id, "host_invoice_reminder");
    expect(list).toHaveLength(3);
    const last = list.find((m) => (m.data as Record<string, string>).last === "1")!;
    const r = render("host_invoice_reminder", "de", { hotel: h, data: last.data as Record<string, unknown>, baseUrl: "https://x" });
    expect(r.text).toContain("2. Mahnung");
    expect(r.text).toContain("letzte Mahnung");
    expect(await remindNow(c.id, "t")).toBeNull();
  });

  it("Bankdatei camt.054: Gutschrift mit QR-Referenz bezahlt die Rechnung, doppelte und fremde Einträge werden gemeldet", async () => {
    setPaymentProvider(new FakePaymentProvider());
    await savePlatformBilling({ iban: QR_IBAN, paymentDays: 30 }, "t");
    expect((await getPlatformBilling()).iban).toBe(QR_IBAN);
    const h = await qrHost();
    await runMonthlyMinimum(new Date(), NO_VAT);
    const c = await chargeOf(h.id);
    const ntry = (ref: string, amt: string, bank: string) => `<Ntry><Amt Ccy="CHF">${amt}</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-12-03</Dt></BookgDt><AcctSvcrRef>${bank}</AcctSvcrRef><NtryDtls><TxDtls><RmtInf><Strd><CdtrRefInf><Ref>${ref}</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry>`;
    const bank = `B-${uid()}`;
    const xml = `<Document><BkToCstmrDbtCdtNtfctn>${ntry(qrReference(c.invoiceNo!), "19.00", bank)}${ntry("000000000000000000000000016", "50.00", `B-${uid()}`)}</BkToCstmrDbtCdtNtfctn></Document>`;
    const r = await importPlatformCamt(xml, "t");
    expect(r.matched.map((m) => m.invoiceNo)).toContain(c.invoiceNo);
    expect(r.unmatched).toHaveLength(1);
    expect((await chargeOf(h.id))).toMatchObject({ status: "succeeded", paidRef: `ref:${bank}` });
    const again = await importPlatformCamt(xml, "t");
    expect(again.duplicates).toBe(1);
    await expect(savePlatformBilling({ iban: "CH00 1234", paymentDays: 30 }, "t")).rejects.toThrow(/IBAN/);
  });
});

describe("Kasse auf der Monatsrechnung (Konzept 6)", () => {
  it("Modul Kasse eingeschaltet: CHF 29 zusätzlich zur Mindestgebühr", async () => {
    setPaymentProvider(new FakePaymentProvider());
    const h = await qrHost();
    const { hotelModules } = await import("../../src/db/schema");
    await db().insert(hotelModules).values({ hotelId: h.id, module: "pos", enabled: true }).onConflictDoUpdate({ target: [hotelModules.hotelId, hotelModules.module], set: { enabled: true } });
    await runMonthlyMinimum(new Date(), NO_VAT);
    expect(await chargeOf(h.id)).toMatchObject({ posModuleRappen: 2900, chargeRappen: 1900 + 2900 });
  });
});
