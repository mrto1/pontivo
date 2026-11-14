import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, hotels, invoices, onsitePayments } from "../../src/db/schema";
import { confirmBooking, createDirectBooking } from "../../src/services/bookings";
import { markBalanceOnsite } from "../../src/services/balance";
import {
  addFolioItem, bookingBalance, createCreditNote, createInvoiceDraft, deleteDraft, deleteFolioItem, InvoiceError, invoiceView, issueInvoice,
  recordOnsitePayment, updateDraft, updateInvoicingSettings, listFolio,
} from "../../src/services/invoicing";
import { vatOf } from "../../src/domain/invoice";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

const IBAN = "CH93 0076 2011 6238 5295 7";

async function setup(over: Record<string, unknown> = {}) {
  const h = await makeHotel();
  await db().update(hotels).set({ postalCode: "8750", city: "Glarus", addressLine: "Seestrasse 1", ...over }).where(eq(hotels.id, h.hotel.id));
  return { ...h, hotel: (await db().select().from(hotels).where(eq(hotels.id, h.hotel.id)))[0] };
}
type S = Awaited<ReturnType<typeof setup>>;
const reload = async (s: S) => (await db().select().from(hotels).where(eq(hotels.id, s.hotel.id)))[0];

async function book(s: S, from = 20, nights = 2) {
  const checkin = inDays(from);
  const { booking } = await createDirectBooking(s.hotel, { roomTypeId: s.rooms[0].roomType.id, ratePlanId: s.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, nights), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
  await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
  return (await db().select().from(bookings).where(eq(bookings.id, booking.id)))[0];
}

describe("Rechnung (SPEC 16.3)", () => {
  it("Entwurf: Zeilen ergeben genau das Buchungstotal; bezahlt → Saldo 0 (Quittung)", async () => {
    const s = await setup();
    const b = await book(s);
    const inv = await createInvoiceDraft(s.hotel, b.id, "t");
    expect(inv.totalRappen).toBe(b.totalRappen);
    expect(inv.vatRappen).toBe(0); // nicht MWST-pflichtig
    const v = await invoiceView(s.hotel, inv.id);
    expect(v!.lines.reduce((a, l) => a + l.amountRappen, 0)).toBe(b.totalRappen);
    expect(v!.openRappen).toBe(0);
    expect(v!.payments.length).toBeGreaterThan(0);
    expect(v!.qrSvg).toBeNull();
    // zweiter Aufruf gibt denselben Entwurf zurück
    expect((await createInvoiceDraft(s.hotel, b.id, "t")).id).toBe(inv.id);
  });

  it("MWST-pflichtig: Sätze und Aufschlüsselung; Einstellungen werden geprüft", async () => {
    const s = await setup();
    await expect(updateInvoicingSettings(s.hotel, { vatLiable: true }, "t")).rejects.toThrow(/MWST-Nummer/);
    await expect(updateInvoicingSettings(s.hotel, { iban: "CH00 0000" }, "t")).rejects.toThrow(/IBAN/);
    await expect(updateInvoicingSettings(s.hotel, { iban: "CH4431999123000889012" }, "t")).rejects.toThrow(/QR-IBAN|IBAN/);
    await expect(updateInvoicingSettings(s.hotel, { qrIban: "CH9300762011623852957" }, "t")).rejects.toThrow(/QR-IBAN/);
    await updateInvoicingSettings(s.hotel, { vatLiable: true, vatNumber: "CHE-123.456.789 MWST", iban: IBAN }, "t");
    const hotel = await reload(s);
    const b = await book(s);
    const inv = await createInvoiceDraft(hotel, b.id, "t");
    const v = await invoiceView(hotel, inv.id);
    const stay = v!.lines.find((l) => l.category === "stay")!;
    expect(stay.vatBps).toBe(380);
    expect(inv.vatRappen).toBe(v!.vat.vatRappen);
    expect(inv.vatRappen).toBeGreaterThanOrEqual(vatOf(stay.amountRappen, 380) - 1);
    for (const r of v!.vat.rows) expect(r.netRappen + r.vatRappen).toBe(r.grossRappen);
  });

  it("Ausstellen: lückenlose Nummer, Empfänger Pflicht, danach unveränderlich; Gutschrift mit eigener Nummer", async () => {
    const s = await setup();
    const b1 = await book(s, 20), b2 = await book(s, 30);
    const d1 = await createInvoiceDraft(s.hotel, b1.id, "t");
    await updateDraft(s.hotel.id, d1.id, { recipient: {}, note: "" }, "t");
    await expect(issueInvoice(s.hotel, d1.id, "t")).rejects.toThrow(/Empfänger/);
    await updateDraft(s.hotel.id, d1.id, { recipient: { name: "Anna Muster", street: "Weg 2", zip: "8000", city: "Zürich", country: "ch" }, note: "Danke" }, "t");
    const i1 = await issueInvoice(s.hotel, d1.id, "t");
    expect(i1.number).toMatch(/^\d{4}-0001$/);
    expect(i1.dueOn).toBeTruthy();
    await expect(issueInvoice(s.hotel, d1.id, "t")).rejects.toBeInstanceOf(InvoiceError);
    await expect(updateDraft(s.hotel.id, d1.id, { recipient: { name: "X" }, note: "" }, "t")).rejects.toThrow(/unveränderlich/);
    await expect(deleteDraft(s.hotel.id, d1.id, "t")).rejects.toBeInstanceOf(InvoiceError);
    const d2 = await createInvoiceDraft(s.hotel, b2.id, "t");
    await updateDraft(s.hotel.id, d2.id, { recipient: { name: "Bruno Beispiel" }, note: "" }, "t");
    expect((await issueInvoice(s.hotel, d2.id, "t")).number).toMatch(/-0002$/);
    // Gutschrift
    await expect(createInvoiceDraft(s.hotel, b1.id, "t")).rejects.toThrow(/schon eine Rechnung/);
    const cn = await createCreditNote(s.hotel, i1.id, "t");
    expect(cn.number).toMatch(/-0003$/);
    expect(cn.totalRappen).toBe(-i1.totalRappen);
    expect(cn.kind).toBe("credit_note");
    await expect(createCreditNote(s.hotel, i1.id, "t")).rejects.toThrow(/schon eine Gutschrift/);
    // danach darf eine neue Rechnung erstellt werden
    expect((await createInvoiceDraft(s.hotel, b1.id, "t")).status).toBe("draft");
  });

  it("Posten (Folio): fliessen in den Entwurf, werden beim Löschen des Entwurfs frei, ausgestellt gesperrt", async () => {
    const s = await setup();
    const b = await book(s);
    const it = await addFolioItem(s.hotel.id, b.id, { description: "Minibar", quantity: 2, unitPriceRappen: 450, vatKind: "standard" }, "t");
    await addFolioItem(s.hotel.id, b.id, { description: "Rabatt", quantity: 1, unitPriceRappen: -300, vatKind: "none" }, "t");
    await expect(addFolioItem(s.hotel.id, b.id, { description: "", quantity: 1, unitPriceRappen: 1, vatKind: "none" }, "t")).rejects.toBeInstanceOf(InvoiceError);
    const bal = await bookingBalance(db(), s.hotel.id, b.id);
    expect(bal.folioRappen).toBe(900 - 300);
    expect(bal.openRappen).toBe(600); // Aufenthalt bezahlt, Posten offen
    const d = await createInvoiceDraft(s.hotel, b.id, "t");
    expect(d.totalRappen).toBe(b.totalRappen + 600);
    await expect(deleteFolioItem(s.hotel.id, it.id, "t")).rejects.toThrow(/schon auf einer Rechnung/);
    await deleteDraft(s.hotel.id, d.id, "t");
    expect((await listFolio(s.hotel.id, b.id)).every((f) => f.invoiceId === null)).toBe(true);
    await deleteFolioItem(s.hotel.id, it.id, "t");
  });

  it("Zahlung vor Ort: offener Betrag sinkt, QR-Rechnung nur bei offenem Betrag mit IBAN; Restzahlung gilt als erledigt", async () => {
    const s = await setup({ depositBps: 3000, balanceDueDays: 7 });
    await updateInvoicingSettings(s.hotel, { iban: IBAN }, "t");
    const hotel = await reload(s);
    const b = await book(s, 40);
    expect(b.balanceRappen).toBeGreaterThan(0);
    const bal0 = await bookingBalance(db(), hotel.id, b.id);
    expect(bal0.openRappen).toBe(b.balanceRappen);
    const d = await createInvoiceDraft(hotel, b.id, "t");
    await updateDraft(hotel.id, d.id, { recipient: { name: "Anna Muster", street: "Weg 2", zip: "8000", city: "Zürich" }, note: "" }, "t");
    await issueInvoice(hotel, d.id, "t");
    const v1 = await invoiceView(hotel, d.id);
    expect(v1!.openRappen).toBe(b.balanceRappen);
    expect(v1!.qrSvg).toContain("<svg");
    await expect(recordOnsitePayment(hotel, b.id, { amountRappen: 0, method: "cash" }, "t")).rejects.toBeInstanceOf(InvoiceError);
    await recordOnsitePayment(hotel, b.id, { amountRappen: b.balanceRappen, method: "cash", note: "bar" }, "t");
    const after = (await db().select().from(bookings).where(eq(bookings.id, b.id)))[0];
    expect(after.balanceOnsiteAt).not.toBeNull();
    const v2 = await invoiceView(hotel, d.id);
    expect(v2!.openRappen).toBe(0);
    expect(v2!.qrSvg).toBeNull();
  });

  it("Mandantentrennung und bisherige «vor Ort erhalten»-Markierung erzeugt eine Zahlung", async () => {
    const s = await setup({ depositBps: 3000, balanceDueDays: 7 });
    const other = await setup();
    const b = await book(s, 40);
    await expect(createInvoiceDraft(other.hotel, b.id, "t")).rejects.toBeInstanceOf(InvoiceError);
    await expect(recordOnsitePayment(other.hotel, b.id, { amountRappen: 100, method: "cash" }, "t")).rejects.toBeInstanceOf(InvoiceError);
    await markBalanceOnsite(s.hotel.id, b.id, "t");
    const rows = await db().select().from(onsitePayments).where(eq(onsitePayments.bookingId, b.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].amountRappen).toBe(b.balanceRappen);
    expect((await bookingBalance(db(), s.hotel.id, b.id)).openRappen).toBe(0);
    const all = await db().select().from(invoices).where(eq(invoices.hotelId, other.hotel.id));
    expect(all).toHaveLength(0);
  });
});
