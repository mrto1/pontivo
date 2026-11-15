import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { folioItems, hotels, posOrderLines, posReceipts } from "../../src/db/schema";
import { createAdminBooking } from "../../src/services/admin-bookings";
import { createInvoiceDraft, updateInvoicingSettings } from "../../src/services/invoicing";
import { assignRoom, listRooms, seedRooms } from "../../src/services/frontdesk";
import { bookingRooms } from "../../src/db/schema";
import {
  PosError, addDiscount, addLines, closeDay, createDevice, dayReportFor, exportCsv, openOrder, orderView, pay, receiptsOfDay, reverseLine, reverseReceipt, saveItem, saveTable, verifyHotel,
} from "../../src/services/pos";
import { addDays, todayIn } from "../../src/domain/dates";
import { makeHotel } from "../helpers";

afterAll(closeDb);

async function setup(vatLiable = true) {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, basePriceRappen: 15000 }]);
  await updateInvoicingSettings(h.hotel, { vatLiable, vatNumber: "CHE-123.456.789 MWST" }, "t");
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  const soup = await saveItem(hotel.id, null, { category: "Essen", name: "Suppe", priceRappen: 1000, vatDineInBps: 810, vatTakeawayBps: 260 }, "t");
  const wine = await saveItem(hotel.id, null, { category: "Getränke", name: "Wein", priceRappen: 2000, vatDineInBps: 810, vatTakeawayBps: 810 }, "t");
  const table = await saveTable(hotel.id, "Tisch 1", "t");
  const dev = await createDevice(hotel.id, "T1", "Tablet 1", "t");
  const order = await openOrder(hotel.id, { tableId: table.id, deviceId: dev.id }, "kellner");
  return { ...h, hotel, soup, wine, table, dev, order };
}
type S = Awaited<ReturnType<typeof setup>>;
const payCash = (s: S, sel: { lineId: string; quantity: number }[], amount: number, extra: object = {}) =>
  pay(s.hotel, { orderId: s.order.id, deviceId: s.dev.id, selection: sel, payments: [{ method: "cash", amountRappen: amount }], ...extra }, "kellner");

describe("Kasse Service (SPEC 19.16)", () => {
  it("bestellen, splitten, bezahlen, Bons verkettet und unveränderbar", async () => {
    const s = await setup();
    const [a, b] = await addLines(s.hotel, s.order.id, [{ itemId: s.soup.id, quantity: 2 }, { itemId: s.wine.id, quantity: 1 }], "kellner");
    expect(a.vatBps).toBe(810);
    const r1 = await payCash(s, [{ lineId: a.id, quantity: 1 }], 1000); // Gast 1 zahlt eine Suppe
    expect(r1.number).toBe("T1-000001");
    await expect(payCash(s, [{ lineId: a.id, quantity: 2 }], 2000)).rejects.toBeInstanceOf(PosError); // nur noch 1 offen
    await expect(payCash(s, [{ lineId: b.id, quantity: 1 }], 1999)).rejects.toThrow(/ergeben nicht/);
    const r2 = await pay(s.hotel, { orderId: s.order.id, deviceId: s.dev.id, selection: [{ lineId: a.id, quantity: 1 }, { lineId: b.id, quantity: 1 }], payments: [{ method: "card", amountRappen: 3000 }], tipRappen: 200 }, "kellner");
    expect(r2.number).toBe("T1-000002");
    expect(r2.prevHash).toBe(r1.hash);
    expect((await orderView(s.hotel.id, s.order.id))!.openTotalRappen).toBe(0);
    expect(await verifyHotel(s.hotel.id)).toEqual({ receipts: 2, brokenAtSeq: null, gaps: [] });
    // Datenbank verbietet Ändern und Löschen
    await expect(db().update(posReceipts).set({ totalRappen: 1 }).where(eq(posReceipts.id, r1.id))).rejects.toThrow();
    await expect(db().delete(posReceipts).where(eq(posReceipts.id, r1.id))).rejects.toThrow();
    await expect(db().delete(posOrderLines).where(eq(posOrderLines.id, a.id))).rejects.toThrow();
  });

  it("Storno ungezahlter Zeilen mit Grund, bezahlte nur per Gegenbon", async () => {
    const s = await setup();
    const [a] = await addLines(s.hotel, s.order.id, [{ itemId: s.soup.id, quantity: 3 }], "k");
    await expect(reverseLine(s.hotel.id, a.id, 1, " ", "m")).rejects.toThrow(/Grund/);
    await reverseLine(s.hotel.id, a.id, 2, "falsch bestellt", "m");
    await expect(reverseLine(s.hotel.id, a.id, 2, "x", "m")).rejects.toBeInstanceOf(PosError); // nur 1 offen
    expect((await orderView(s.hotel.id, s.order.id))!.openTotalRappen).toBe(1000);
    const r = await payCash(s, [{ lineId: a.id, quantity: 1 }], 1000);
    await expect(reverseLine(s.hotel.id, a.id, 1, "zu spät", "m")).rejects.toThrow(/bezahlt/);
    const g = await reverseReceipt(s.hotel, r.id, s.dev.id, "Gast reklamiert", "m");
    expect(g.totalRappen).toBe(-1000);
    expect(g.kind).toBe("reversal");
    await expect(reverseReceipt(s.hotel, r.id, s.dev.id, "nochmals", "m")).rejects.toThrow(/schon/);
    expect((await orderView(s.hotel.id, s.order.id))!.openTotalRappen).toBe(1000); // wieder offen
    expect((await verifyHotel(s.hotel.id)).brokenAtSeq).toBeNull();
  });

  it("Rabatt mit Grund", async () => {
    const s = await setup();
    const [a] = await addLines(s.hotel, s.order.id, [{ itemId: s.wine.id, quantity: 1 }], "k");
    await expect(addDiscount(s.hotel, s.order.id, { description: "Rabatt", amountRappen: 500, vatBps: 810, reason: "" }, "m")).rejects.toThrow(/Grund/);
    const d = await addDiscount(s.hotel, s.order.id, { description: "Rabatt Stammgast", amountRappen: 500, vatBps: 810, reason: "Stammgast" }, "m");
    expect((await orderView(s.hotel.id, s.order.id))!.openTotalRappen).toBe(1500);
    const r = await payCash(s, [{ lineId: a.id, quantity: 1 }, { lineId: d.id, quantity: 1 }], 1500);
    expect(r.totalRappen).toBe(1500);
  });

  it("Take-away hat den eigenen MWST-Satz; nicht MWST-pflichtig = 0", async () => {
    const s = await setup();
    const [t] = await addLines(s.hotel, s.order.id, [{ itemId: s.soup.id, quantity: 1, mode: "takeaway" }], "k");
    expect(t.vatBps).toBe(260);
    const n = await setup(false);
    const [x] = await addLines(n.hotel, n.order.id, [{ itemId: n.soup.id, quantity: 1 }], "k");
    expect(x.vatBps).toBe(0);
  });

  it("aufs Zimmer: Posten mit eigenem MWST-Satz, Gegenbon bucht gegen, nach Rechnung gesperrt", async () => {
    const s = await setup();
    const today = todayIn(s.hotel.timezone);
    await seedRooms(s.hotel.id, s.rooms[0].roomType.id, "t");
    const bk = await createAdminBooking(s.hotel, { roomTypeId: s.rooms[0].roomType.id, ratePlanId: s.rooms[0].plans[0].id, checkin: today, checkout: addDays(today, 2), adults: 2, children: 0, guest: { firstName: "Max", lastName: "Muster", email: "", language: "de" }, notifyGuest: false }, "t");
    const [a, w] = await addLines(s.hotel, s.order.id, [{ itemId: s.soup.id, quantity: 1, mode: "takeaway" }, { itemId: s.wine.id, quantity: 1 }], "k");
    const room = (sel: { lineId: string; quantity: number }[], amount: number, ref = bk.reference, extra: object = {}) =>
      pay(s.hotel, { orderId: s.order.id, deviceId: s.dev.id, selection: sel, payments: [{ method: "room", amountRappen: amount }], bookingReference: ref, ...extra }, "k");
    await expect(room([{ lineId: a.id, quantity: 1 }], 1000, "NOPE00")).rejects.toThrow(/Buchung/);
    const r = await room([{ lineId: a.id, quantity: 1 }, { lineId: w.id, quantity: 1 }], 3000, bk.reference.toLowerCase(), { tipRappen: 300 });
    const items = await db().select().from(folioItems).where(eq(folioItems.bookingId, bk.id));
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.vatBpsOverride).sort()).toEqual([260, 810, null].sort());
    expect(items.reduce((x, i) => x + i.quantity * i.unitPriceRappen, 0)).toBe(3300);
    // Gegenbon bucht negativ gegen
    const g = await reverseReceipt(s.hotel, r.id, s.dev.id, "Fehlbuchung", "m");
    expect(g.totalRappen).toBe(-3000);
    const after = await db().select().from(folioItems).where(eq(folioItems.bookingId, bk.id));
    expect(after.reduce((x, i) => x + i.quantity * i.unitPriceRappen, 0)).toBe(0);
    // Rechnung: Posten mit Satz 2,6 % erscheint mit diesem Satz
    const [b2] = await addLines(s.hotel, s.order.id, [{ itemId: s.soup.id, quantity: 1, mode: "takeaway" }], "k");
    const r2 = await room([{ lineId: b2.id, quantity: 1 }], 1000);
    const draft = await createInvoiceDraft(s.hotel, bk.id, "t");
    expect(draft.id).toBeTruthy();
    await expect(reverseReceipt(s.hotel, r2.id, s.dev.id, "zu spät", "m")).rejects.toThrow(/Rechnung/);
    void bookingRooms; void assignRoom; void listRooms;
  });

  it("Wiederholung vom Gerät (gleiche receiptId) bucht nichts doppelt; Lücken im Nummernkreis", async () => {
    const s = await setup();
    const [a] = await addLines(s.hotel, s.order.id, [{ itemId: s.soup.id, quantity: 2 }], "k");
    const id = crypto.randomUUID();
    const r1 = await payCash(s, [{ lineId: a.id, quantity: 1 }], 1000, { receiptId: id, bonNo: 1 });
    const r2 = await payCash(s, [{ lineId: a.id, quantity: 1 }], 1000, { receiptId: id, bonNo: 1 });
    expect(r2.id).toBe(r1.id);
    expect((await orderView(s.hotel.id, s.order.id))!.openTotalRappen).toBe(1000);
    await payCash(s, [{ lineId: a.id, quantity: 1 }], 1000, { bonNo: 3 }); // Gerät hat Nr. 2 nie geschickt
    expect((await verifyHotel(s.hotel.id)).gaps).toEqual([{ code: "T1", gaps: [2] }]);
  });

  it("gleichzeitig bezahlen: dieselbe Zeile nur einmal", async () => {
    const s = await setup();
    const [a] = await addLines(s.hotel, s.order.id, [{ itemId: s.soup.id, quantity: 1 }], "k");
    const res = await Promise.allSettled([1, 2, 3].map(() => payCash(s, [{ lineId: a.id, quantity: 1 }], 1000)));
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await verifyHotel(s.hotel.id)).brokenAtSeq).toBeNull();
  });

  it("Tagesabschluss: Bericht, Differenz, einmalig; spätere Bons zählen am nächsten offenen Tag", async () => {
    const s = await setup();
    const [a, w] = await addLines(s.hotel, s.order.id, [{ itemId: s.soup.id, quantity: 1 }, { itemId: s.wine.id, quantity: 2 }], "k");
    await payCash(s, [{ lineId: a.id, quantity: 1 }], 1000, { tipRappen: 100 });
    await pay(s.hotel, { orderId: s.order.id, deviceId: s.dev.id, selection: [{ lineId: w.id, quantity: 1 }], payments: [{ method: "twint", amountRappen: 2000 }] }, "k");
    const today = todayIn(s.hotel.timezone);
    const rep = await dayReportFor(s.hotel.id, today);
    expect(rep.byMethod).toMatchObject({ cash: 1000, twint: 2000 });
    expect(rep.expectedCashRappen).toBe(1100);
    const c = await closeDay(s.hotel, today, 1000, "100 Fr. Trinkgeld fehlen", "chef");
    expect(c.differenceRappen).toBe(-100);
    await expect(closeDay(s.hotel, today, 1100, "", "chef")).rejects.toThrow(/schon abgeschlossen/);
    await expect(closeDay(s.hotel, addDays(today, 1), 0, "", "chef")).rejects.toThrow(/Zukunft/);
    await expect(db().delete((await import("../../src/db/schema")).posDayCloses)).rejects.toThrow();
    const late = await pay(s.hotel, { orderId: s.order.id, deviceId: s.dev.id, selection: [{ lineId: w.id, quantity: 1 }], payments: [{ method: "cash", amountRappen: 2000 }] }, "k");
    expect(late.late).toBe(true);
    expect(late.businessDay).toBe(addDays(today, 1));
    expect((await receiptsOfDay(s.hotel.id, today))).toHaveLength(2);
    const csv = await exportCsv(s.hotel.id, today, addDays(today, 1));
    expect(csv).toContain("T1-000001");
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(4);
  });

  it("Mandantentrennung", async () => {
    const s = await setup();
    const o = await setup();
    const [a] = await addLines(s.hotel, s.order.id, [{ itemId: s.soup.id, quantity: 1 }], "k");
    await expect(pay(o.hotel, { orderId: s.order.id, deviceId: o.dev.id, selection: [{ lineId: a.id, quantity: 1 }], payments: [{ method: "cash", amountRappen: 1000 }] }, "x")).rejects.toThrow(/Bestellung nicht gefunden/);
    await expect(addLines(o.hotel, s.order.id, [{ itemId: o.soup.id, quantity: 1 }], "x")).rejects.toThrow(/Bestellung nicht gefunden/);
    await expect(addLines(s.hotel, s.order.id, [{ itemId: o.soup.id, quantity: 1 }], "x")).rejects.toThrow(/nicht verfügbar/);
    await expect(openOrder(o.hotel.id, { id: s.order.id }, "x")).rejects.toThrow(/anderen Betrieb/);
    await expect(reverseLine(o.hotel.id, a.id, 1, "x", "x")).rejects.toThrow(/Zeile nicht gefunden/);
  });
});
