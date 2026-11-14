import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, hotels } from "../../src/db/schema";
import { confirmBooking, createDirectBooking } from "../../src/services/bookings";
import { createInvoiceDraft, issueInvoice, recordOnsitePayment, updateDraft, updateInvoicingSettings, createCreditNote } from "../../src/services/invoicing";
import { accountsOf, AccountingExportError, journalFor, periodRange, saveAccounts } from "../../src/services/accounting-export";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

describe("Buchungsjournal-Export (SPEC 18.3)", () => {
  it("Zeiträume", () => {
    expect(periodRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28", label: "2026-02" });
    expect(periodRange("2026-Q4")).toMatchObject({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodRange("2027")).toMatchObject({ from: "2027-01-01", to: "2027-12-31" });
    expect(periodRange("2026-13")).toBeNull();
  });

  it("Rechnung + Zahlungen + Gutschrift ergeben ausgeglichene Buchungen; nur im Zeitraum; getrennt pro Betrieb", async () => {
    const h = await makeHotel();
    await db().update(hotels).set({ postalCode: "8750", city: "Glarus", addressLine: "Seestrasse 1" }).where(eq(hotels.id, h.hotel.id));
    let hotel = (await db().select().from(hotels).where(eq(hotels.id, h.hotel.id)))[0];
    await updateInvoicingSettings(hotel, { vatLiable: true, vatNumber: "CHE-123.456.789 MWST" }, "t");
    hotel = (await db().select().from(hotels).where(eq(hotels.id, h.hotel.id)))[0];
    const checkin = inDays(20);
    const { booking } = await createDirectBooking(hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, 2), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
    await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
    const b = (await db().select().from(bookings).where(eq(bookings.id, booking.id)))[0];
    const d = await createInvoiceDraft(hotel, b.id, "t");
    await updateDraft(hotel.id, d.id, { recipient: { name: "Anna Muster", company: "Muster AG" }, note: "" }, "t");
    const inv = await issueInvoice(hotel, d.id, "t");
    const today = inv.issuedOn!;
    await recordOnsitePayment(hotel, b.id, { amountRappen: 1000, method: "cash", receivedOn: today }, "t").catch(() => undefined);
    const rows = await journalFor(hotel, today, today);
    const a = accountsOf(hotel);
    const debitRecv = rows.filter((r) => r.debit === a.receivable).reduce((s, r) => s + r.rappen, 0);
    expect(debitRecv).toBe(b.totalRappen); // Forderung = Rechnungstotal (Ertrag netto + MWST + Kurtaxe)
    expect(rows.some((r) => r.credit === a.vat)).toBe(true);
    expect(rows.every((r) => r.rappen > 0)).toBe(true);
    expect(rows.find((r) => r.doc === inv.number)!.text).toContain("Muster AG");
    // ausserhalb des Zeitraums nichts
    expect(await journalFor(hotel, addDays(today, 5), addDays(today, 6))).toHaveLength(0);
    // Gutschrift kehrt die Forderung um
    const cn = await createCreditNote(hotel, inv.id, "t");
    const after = await journalFor(hotel, today, today);
    expect(after.filter((r) => r.doc === cn.number && r.credit === a.receivable).reduce((s, r) => s + r.rappen, 0)).toBe(b.totalRappen);
    // anderer Betrieb sieht nichts
    const o = await makeHotel();
    expect(await journalFor(o.hotel, today, today)).toHaveLength(0);
    // Konten speichern und prüfen
    await saveAccounts(hotel, { receivable: "1105" }, "t");
    expect(accountsOf((await db().select().from(hotels).where(eq(hotels.id, hotel.id)))[0]).receivable).toBe("1105");
    await expect(saveAccounts(hotel, { bank: "10 20" }, "t")).rejects.toThrow(AccountingExportError);
  });
});
