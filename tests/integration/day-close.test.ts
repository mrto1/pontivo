import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, hotels } from "../../src/db/schema";
import { confirmBooking, createDirectBooking } from "../../src/services/bookings";
import { createCreditNote, createInvoiceDraft, InvoiceError, issueInvoice, recordOnsitePayment, updateDraft } from "../../src/services/invoicing";
import { closeDay, dayTotals, DayCloseError, getDayClose, listDayCloses } from "../../src/services/day-close";
import { addDays, todayIn } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

async function setup() {
  const h = await makeHotel();
  await db().update(hotels).set({ postalCode: "8750", city: "Glarus", addressLine: "Seestrasse 1" }).where(eq(hotels.id, h.hotel.id));
  const hotel = (await db().select().from(hotels).where(eq(hotels.id, h.hotel.id)))[0];
  const checkin = inDays(20);
  const { booking } = await createDirectBooking(hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, 2), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
  await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
  const b = (await db().select().from(bookings).where(eq(bookings.id, booking.id)))[0];
  return { hotel, booking: b, today: todayIn(hotel.timezone) };
}

describe("Tagesabschluss (SPEC 19.1)", () => {
  it("Summen, Kassenzählung mit Differenz, danach ist der Tag gesperrt", async () => {
    const { hotel, booking, today } = await setup();
    await recordOnsitePayment(hotel, booking.id, { amountRappen: 5000, method: "cash" }, "t");
    await recordOnsitePayment(hotel, booking.id, { amountRappen: 3000, method: "card" }, "t");
    await recordOnsitePayment(hotel, booking.id, { amountRappen: -500, method: "cash", note: "Rückzahlung" }, "t");
    const draft = await createInvoiceDraft(hotel, booking.id, "t");
    await updateDraft(hotel.id, draft.id, { recipient: { name: "Test Gast" }, note: "" }, "t");
    await issueInvoice(hotel, draft.id, "t");

    const tot = await dayTotals(db(), hotel, today);
    expect(tot.onsite).toEqual({ cash: 4500, card: 3000 });
    expect(tot.invoices.count).toBe(1);
    expect(tot.invoices.grossRappen).toBeGreaterThan(0);

    const c = await closeDay(hotel, today, { cashCountedRappen: 4400, note: "10 Franken fehlen" }, "t");
    expect(c.cashExpectedRappen).toBe(4500);
    expect(c.differenceRappen).toBe(-100);
    expect((await getDayClose(hotel.id, today))!.totals.onsite.card).toBe(3000);

    // gesperrt: Zahlung, Rechnung, Gutschrift mit Datum dieses Tages; doppelter Abschluss
    await expect(recordOnsitePayment(hotel, booking.id, { amountRappen: 100, method: "cash" }, "t")).rejects.toBeInstanceOf(InvoiceError);
    await expect(createCreditNote(hotel, draft.id, "t")).rejects.toThrow(/abgeschlossen/);
    await expect(closeDay(hotel, today, { cashCountedRappen: null }, "t")).rejects.toBeInstanceOf(DayCloseError);
    // ein früherer, offener Tag lässt sich weiter buchen
    await recordOnsitePayment(hotel, booking.id, { amountRappen: 100, method: "cash", receivedOn: addDays(today, -1) }, "t");
    expect((await listDayCloses(hotel.id)).map((x) => x.day)).toEqual([today]);
  });

  it("Zukunft und ungültige Eingaben werden abgelehnt; ohne Zählung keine Differenz", async () => {
    const { hotel, today } = await setup();
    await expect(closeDay(hotel, addDays(today, 1), { cashCountedRappen: null }, "t")).rejects.toThrow(/Zukunft/);
    await expect(closeDay(hotel, "kaputt", { cashCountedRappen: null }, "t")).rejects.toBeInstanceOf(DayCloseError);
    await expect(closeDay(hotel, today, { cashCountedRappen: -5 }, "t")).rejects.toBeInstanceOf(DayCloseError);
    const c = await closeDay(hotel, addDays(today, -1), { cashCountedRappen: null }, "t");
    expect(c.differenceRappen).toBe(0);
    expect(c.cashCountedRappen).toBeNull();
  });

  it("Mandantentrennung: Abschluss von Hotel A sperrt Hotel B nicht", async () => {
    const a = await setup();
    const b = await setup();
    await closeDay(a.hotel, a.today, { cashCountedRappen: 0 }, "t");
    await expect(recordOnsitePayment(b.hotel, b.booking.id, { amountRappen: 100, method: "cash" }, "t")).resolves.toBeTruthy();
    expect(await getDayClose(b.hotel.id, b.today)).toBeNull();
  });
});
