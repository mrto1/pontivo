import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { folioItems, goods } from "../../src/db/schema";
import { confirmBooking, createDirectBooking } from "../../src/services/bookings";
import { GoodsError, adjustStock, deleteGood, listGoods, reorderList, saveGood, sellToBooking } from "../../src/services/goods";
import { addDays } from "../../src/domain/dates";
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
});
