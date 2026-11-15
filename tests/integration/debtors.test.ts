import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { emailOutbox, hotels, invoices, onsitePayments } from "../../src/db/schema";
import { createAdminBooking } from "../../src/services/admin-bookings";
import { createInvoiceDraft, invoiceView, issueInvoice, updateInvoicingSettings } from "../../src/services/invoicing";
import { closeDay } from "../../src/services/day-close";
import {
  DebtorError, agingTotals, importBankFile, listOpenInvoices, recordInvoicePayment, saveCompany, sendDunning, setBookingCompany,
} from "../../src/services/debtors";
import { qrReference } from "../../src/domain/invoice";
import { addDays, todayIn } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

async function setup() {
  const h = await makeHotel();
  await db().update(hotels).set({ postalCode: "8750", city: "Glarus", addressLine: "Seestrasse 1" }).where(eq(hotels.id, h.hotel.id));
  await updateInvoicingSettings((await db().select().from(hotels).where(eq(hotels.id, h.hotel.id)))[0], { iban: "CH93 0076 2011 6238 5295 7" }, "t");
  return { ...h, hotel: (await db().select().from(hotels).where(eq(hotels.id, h.hotel.id)))[0] };
}
type S = Awaited<ReturnType<typeof setup>>;

/** Vom Hotel erfasste Buchung (bezahlt wird später per Rechnung, nichts online bezahlt) */
async function book(s: S, from = 20, nights = 2) {
  const checkin = inDays(from);
  return createAdminBooking(s.hotel, { roomTypeId: s.rooms[0].roomType.id, ratePlanId: s.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, nights), adults: 2, children: 0, guest: { firstName: "Max", lastName: "Muster", email: "", language: "de" }, notifyGuest: false }, "t");
}
/** Rechnung auf Firma, ausgestellt */
async function issued(s: S, days: number | null = 14) {
  const co = await saveCompany(s.hotel.id, null, { name: "Muster AG", street: "Weg 1", zip: "8000", city: "Zürich", email: "buchhaltung@muster.ch", paymentDays: days }, "t");
  const b = await book(s);
  await setBookingCompany(s.hotel.id, b.id, co.id, "t");
  const draft = await createInvoiceDraft(s.hotel, b.id, "t");
  const inv = await issueInvoice(s.hotel, draft.id, "t");
  return { co, b, inv };
}
const camt = (ref: string, amt: string, date: string, bank: string) => `<Document><BkToCstmrDbtCdtNtfctn><Ntfctn><Ntry><Amt Ccy="CHF">${amt}</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>${date}</Dt></BookgDt><AcctSvcrRef>${bank}</AcctSvcrRef><NtryDtls><TxDtls><RmtInf><Strd><CdtrRefInf><Ref>${ref}</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;

describe("Debitoren (SPEC 19.7)", () => {
  it("Rechnung auf Firma: Empfänger aus der Firma, eigene Zahlungsfrist, erscheint als offen", async () => {
    const s = await setup();
    const { co, inv } = await issued(s, 14);
    expect(inv.recipient.company).toBe("Muster AG");
    expect(inv.companyId).toBe(co.id);
    expect(inv.dueOn).toBe(addDays(inv.issuedOn!, 14));
    const open = await listOpenInvoices(s.hotel);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ number: inv.number, payer: "Muster AG", openRappen: inv.totalRappen, bucket: "not_due" });
  });

  it("ohne Firmenfrist gilt die Standardfrist; Firma lösen oder zuordnen geht nur vor der Rechnung", async () => {
    const s = await setup();
    const { inv, b, co } = await issued(s, null);
    expect(inv.dueOn).toBe(addDays(inv.issuedOn!, 30));
    await expect(setBookingCompany(s.hotel.id, b.id, null, "t")).rejects.toThrow(/Rechnung ausgestellt/);
    const other = await setup();
    await expect(setBookingCompany(other.hotel.id, (await book(other)).id, co.id, "t")).rejects.toBeInstanceOf(DebtorError); // fremde Firma
  });

  it("Zahlungseingang: Teilzahlung, dann ganz bezahlt = nicht mehr offen; Zahlungsart Überweisung", async () => {
    const s = await setup();
    const { inv, b } = await issued(s);
    await recordInvoicePayment(s.hotel, inv.id, { amountRappen: 10000, note: "Teil" }, "t");
    expect((await listOpenInvoices(s.hotel))[0].openRappen).toBe(inv.totalRappen - 10000);
    await recordInvoicePayment(s.hotel, inv.id, { amountRappen: inv.totalRappen - 10000 }, "t");
    expect(await listOpenInvoices(s.hotel)).toHaveLength(0);
    const pays = await db().select().from(onsitePayments).where(eq(onsitePayments.bookingId, b.id));
    expect(pays.every((p) => p.method === "bank" && p.note.includes(inv.number!))).toBe(true);
    expect((await invoiceView(s.hotel, inv.id))!.openRappen).toBe(0);
  });

  it("Mahnwesen: Stufen erst nach Frist, der Reihe nach, Mail in der Outbox, nie doppelt", async () => {
    const s = await setup();
    const { inv, b } = await issued(s, 10);
    const late = (d: number) => new Date(Date.parse(addDays(inv.dueOn!, d) + "T12:00:00Z"));
    await expect(sendDunning(s.hotel, inv.id, "t", late(2))).rejects.toThrow(/Noch nicht fällig/);
    expect(await sendDunning(s.hotel, inv.id, "t", late(6))).toBe(1);
    await expect(sendDunning(s.hotel, inv.id, "t", late(7))).rejects.toThrow(/Noch nicht fällig/);
    expect(await sendDunning(s.hotel, inv.id, "t", late(25))).toBe(2);
    expect(await sendDunning(s.hotel, inv.id, "t", late(40))).toBe(3);
    await expect(sendDunning(s.hotel, inv.id, "t", late(80))).rejects.toThrow(/drei Stufen/);
    const mail = await db().select().from(emailOutbox).where(and(eq(emailOutbox.bookingId, b.id), eq(emailOutbox.template, "dunning")));
    expect(mail).toHaveLength(1);
    expect(mail[0].toEmail).toBe("buchhaltung@muster.ch");
    expect((mail[0].data as { level: number }).level).toBe(3);
    const at = (await listOpenInvoices(s.hotel, late(80)))[0];
    expect(at.bucket).toBe("d60_plus");
    expect(agingTotals([at]).d60_plus).toBe(at.openRappen);
  });

  it("Bankdatei: Zahlung mit QR-Referenz wird verbucht, zweiter Import ist wirkungslos, Unbekanntes wird gemeldet", async () => {
    const s = await setup();
    const { inv } = await issued(s);
    const today = todayIn("Europe/Zurich");
    const xml = camt(qrReference(inv.number!), (inv.totalRappen / 100).toFixed(2), today, "B-1") + "";
    const r1 = await importBankFile(s.hotel, xml, "t");
    expect(r1.matched).toEqual([{ invoiceNumber: inv.number, amountRappen: inv.totalRappen }]);
    expect(await listOpenInvoices(s.hotel)).toHaveLength(0);
    const r2 = await importBankFile(s.hotel, xml, "t");
    expect(r2.matched).toHaveLength(0);
    expect(r2.duplicates).toBe(1);
    expect((await db().select().from(onsitePayments).where(eq(onsitePayments.hotelId, s.hotel.id)))).toHaveLength(1);
    const r3 = await importBankFile(s.hotel, camt("210000000000000000000000000", "50.00", today, "B-2"), "t");
    expect(r3.unmatched).toHaveLength(1);
    await expect(importBankFile(s.hotel, "<x/>", "t")).rejects.toThrow(/camt\.054/);
  });

  it("Bankdatei mit Datum in einem abgeschlossenen Tag: gebucht auf heute, Valuta in der Notiz", async () => {
    const s = await setup();
    const { inv, b } = await issued(s);
    const yesterday = addDays(todayIn("Europe/Zurich"), -1);
    await closeDay(s.hotel, yesterday, { cashCountedRappen: null, note: "" }, "t");
    await importBankFile(s.hotel, camt(qrReference(inv.number!), (inv.totalRappen / 100).toFixed(2), yesterday, "B-3"), "t");
    const [p] = await db().select().from(onsitePayments).where(eq(onsitePayments.bookingId, b.id));
    expect(p.receivedOn).toBe(todayIn("Europe/Zurich"));
    expect(p.note).toContain(`Valuta ${yesterday}`);
  });

  it("gutgeschriebene Rechnungen sind nicht offen; Mandantentrennung", async () => {
    const a = await setup(), other = await setup();
    await issued(a);
    expect(await listOpenInvoices(other.hotel)).toHaveLength(0);
    const [i] = await db().select().from(invoices).where(eq(invoices.hotelId, a.hotel.id));
    await expect(recordInvoicePayment(other.hotel, i.id, { amountRappen: 100 }, "t")).rejects.toBeInstanceOf(DebtorError);
  });
});
