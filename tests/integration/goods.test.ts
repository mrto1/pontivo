import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { folioItems, goods } from "../../src/db/schema";
import { confirmBooking, createDirectBooking } from "../../src/services/bookings";
import { GoodsError, adjustStock, countMinibar, markRefilled, refillList, deleteGood, listGoods, reorderList, saveGood, sellToBooking } from "../../src/services/goods";
import { seedRooms, listRooms, assignRoom } from "../../src/services/frontdesk";
import { bookingRooms } from "../../src/db/schema";
import { PosError, addLines, createDevice, openOrder, pay, reverseLine, reverseReceipt, saveItem } from "../../src/services/pos";
import { linkPosItem } from "../../src/services/goods";
import { addDays, todayIn } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

const base = { name: "Wasser", category: "Getränke", priceRappen: 450, vat: "standard" as const, sellable: true, active: true, minibar: false, minibarPar: 0, trackStock: false, stock: 0, minStock: 0 };

async function setup() {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
  const rt = h.rooms[0];
  const checkin = inDays(1);
  const { booking } = await createDirectBooking(h.hotel, { roomTypeId: rt.roomType.id, ratePlanId: rt.plans[0].id, checkin, checkout: addDays(checkin, 2), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
  await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
  return { h, booking };
}

describe("Shop & Lager (SPEC 19.51)", () => {
  it("Minibar nur mit Unterkunft; Sollmenge geprüft; Mandantentrennung", async () => {
    const { h } = await setup();
    const other = await setup();
    const m = await saveGood(h.hotel.id, null, { ...base, minibar: true, minibarPar: 2 }, "t", true);
    expect(m).toMatchObject({ minibar: true, minibarPar: 2 });
    const r = await saveGood(h.hotel.id, null, { ...base, name: "Mehl", minibar: true, minibarPar: 2 }, "t", false);
    expect(r).toMatchObject({ minibar: false, minibarPar: 0 });
    await expect(saveGood(h.hotel.id, null, { ...base, minibar: true, minibarPar: 0 }, "t", true)).rejects.toBeInstanceOf(GoodsError);
    await expect(saveGood(h.hotel.id, m.id, { ...base, name: "x" }, "t", true).then(() => saveGood(other.h.hotel.id, m.id, base, "t", true))).rejects.toBeInstanceOf(GoodsError);
    expect((await listGoods(other.h.hotel.id)).length).toBe(0);
  });

  it("Nachbestellen: nur mit Lager, bei Bestand ≤ Mindestbestand; Wareneingang", async () => {
    const { h } = await setup();
    const a = await saveGood(h.hotel.id, null, { ...base, trackStock: true, stock: 3, minStock: 5 }, "t", true);
    await saveGood(h.hotel.id, null, { ...base, name: "Ohne Lager", trackStock: false, stock: 0, minStock: 5 }, "t", true);
    expect((await reorderList(h.hotel.id)).map((x) => x.name)).toEqual(["Wasser"]);
    const b = await adjustStock(h.hotel.id, a.id, 10, "t");
    expect(b.stock).toBe(13);
    expect(await reorderList(h.hotel.id)).toEqual([]);
    await expect(adjustStock(h.hotel.id, a.id, 0, "t")).rejects.toBeInstanceOf(GoodsError);
  });

  it("Aufs Zimmer buchen: Posten mit Kopie von Name, Preis, MWST; Bestand sinkt; reduzierter Satz; Löschen lässt Posten stehen", async () => {
    const { h, booking } = await setup();
    const g = await saveGood(h.hotel.id, null, { ...base, name: "Schokolade", vat: "reduced", priceRappen: 300, trackStock: true, stock: 5, minStock: 1 }, "t", true);
    const item = await sellToBooking(h.hotel.id, booking.id, g.id, 2, "t");
    expect(item).toMatchObject({ description: "Schokolade", quantity: 2, unitPriceRappen: 300, vatKind: "standard", vatBpsOverride: 260 });
    const [after] = await db().select().from(goods).where(eq(goods.id, g.id));
    expect(after.stock).toBe(3);
    const inactive = await saveGood(h.hotel.id, g.id, { ...base, name: "Schokolade", active: false }, "t", true);
    await expect(sellToBooking(h.hotel.id, booking.id, inactive.id, 1, "t")).rejects.toBeInstanceOf(GoodsError);
    await expect(sellToBooking(h.hotel.id, booking.id, g.id, 0, "t")).rejects.toBeInstanceOf(GoodsError);
    await deleteGood(h.hotel.id, g.id, "t");
    expect((await db().select().from(folioItems).where(eq(folioItems.id, item.id))).length).toBe(1);
  });

  it("Minibar zählen: Fehlendes wird dem Gast im Zimmer verrechnet, vollständig = nichts; ohne Gast Fehlermeldung", async () => {
    const { h, booking } = await setup();
    await seedRooms(h.hotel.id, h.rooms[0].roomType.id, "t");
    const [room] = await listRooms(h.hotel.id);
    const g = await saveGood(h.hotel.id, null, { ...base, name: "Cola", priceRappen: 500, minibar: true, minibarPar: 3, trackStock: true, stock: 10 }, "t", true);
    const today = addDays(todayIn(h.hotel.timezone), 2); // Zähltag in der Zukunft: Buchungen in der Vergangenheit sind nicht möglich
    expect(await countMinibar(h.hotel.id, room.id, today, [{ goodId: g.id, present: 3 }], "t")).toEqual({ billed: [], bookingId: null });
    await expect(countMinibar(h.hotel.id, room.id, today, [{ goodId: g.id, present: 1 }], "t")).rejects.toBeInstanceOf(GoodsError);
    // Aufenthalt aus setup(): beginnt morgen, am Zähltag (übermorgen) im Haus
    const [br] = await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, booking.id));
    await assignRoom(h.hotel.id, br.id, room.id, "t");
    const r = await countMinibar(h.hotel.id, room.id, today, [{ goodId: g.id, present: 1 }], "t");
    expect(r.billed).toEqual([{ name: "Cola", quantity: 2 }]);
    const items = await db().select().from(folioItems).where(eq(folioItems.bookingId, booking.id));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 2, unitPriceRappen: 500, source: `minibar:${g.id}` });
    expect((await db().select().from(goods).where(eq(goods.id, g.id)))[0].stock).toBe(8);
    // Nachfüllliste: offener Posten; neue Zählung ersetzt ihn; «Aufgefüllt» erledigt ihn
    expect(await refillList(h.hotel.id)).toEqual([{ roomId: room.id, number: room.number, items: [expect.objectContaining({ name: "Cola", quantity: 2 })] }]);
    await countMinibar(h.hotel.id, room.id, today, [{ goodId: g.id, present: 0 }], "t");
    expect((await refillList(h.hotel.id))[0].items).toEqual([expect.objectContaining({ quantity: 3 })]);
    expect(await markRefilled(h.hotel.id, room.id, "t")).toBe(1);
    expect(await refillList(h.hotel.id)).toEqual([]);
  });

  it("Kasse → Lager: Verkauf senkt den Bestand, Storno und Gegenbon geben ihn zurück; fremde Ware abgelehnt", async () => {
    const { h } = await setup();
    const other = await setup();
    const mehl = await saveGood(h.hotel.id, null, { ...base, name: "Pizzamehl", trackStock: true, stock: 20 }, "t", false);
    const foreign = await saveGood(other.h.hotel.id, null, base, "t", true);
    const item = await saveItem(h.hotel.id, null, { category: "Laden", name: "Pizzamehl 1 kg", priceRappen: 400, vatDineInBps: 260, vatTakeawayBps: 260 }, "t");
    await expect(linkPosItem(h.hotel.id, item.id, foreign.id, "t")).rejects.toBeInstanceOf(GoodsError);
    await linkPosItem(h.hotel.id, item.id, mehl.id, "t");
    const dev = await createDevice(h.hotel.id, "T1", "Tablet", "t");
    const order = await openOrder(h.hotel.id, { deviceId: dev.id }, "k");
    const [line] = await addLines(h.hotel, order.id, [{ itemId: item.id, quantity: 5 }], "k");
    const stock = async () => (await db().select().from(goods).where(eq(goods.id, mehl.id)))[0].stock;
    expect(await stock()).toBe(15);
    await reverseLine(h.hotel.id, line.id, 2, "falsch", "k");
    expect(await stock()).toBe(17);
    const receipt = await pay(h.hotel, { orderId: order.id, deviceId: dev.id, selection: [{ lineId: line.id, quantity: 3 }], payments: [{ method: "cash", amountRappen: 1200 }] }, "k");
    expect(await stock()).toBe(17);
    await reverseReceipt(h.hotel, receipt.id, dev.id, "Rückgabe", "k");
    expect(await stock()).toBe(20);
    void PosError;
  });
});
