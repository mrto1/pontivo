import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../../src/db/client";
import { hotels } from "../../src/db/schema";
import { eq } from "drizzle-orm";
import { PosError, addLines, catalogGroups, createDevice, listOptionGroups, openOrder, orderView, saveItem, saveOption, saveOptionGroup, setGroupItems, setOptionActive } from "../../src/services/pos";
import { makeHotel } from "../helpers";

afterAll(closeDb);

async function setup() {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, basePriceRappen: 15000 }]);
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  const steak = await saveItem(hotel.id, null, { category: "Essen", name: "Entrecôte", priceRappen: 4200, vatDineInBps: 810, vatTakeawayBps: 260 }, "t");
  const dev = await createDevice(hotel.id, "T1", "Tablet", "t");
  const order = await openOrder(hotel.id, { tableId: null, deviceId: dev.id, label: "Bar" }, "k");
  const garstufe = await saveOptionGroup(hotel.id, null, { name: "Garstufe", required: true, maxChoices: 1 }, "t");
  const medium = await saveOption(hotel.id, garstufe.id, { name: "medium", priceRappen: 0 }, "t");
  const rare = await saveOption(hotel.id, garstufe.id, { name: "rare", priceRappen: 0 }, "t");
  const beilage = await saveOptionGroup(hotel.id, null, { name: "Extras", required: false, maxChoices: 2 }, "t");
  const pilze = await saveOption(hotel.id, beilage.id, { name: "Pilze", priceRappen: 350 }, "t");
  await setGroupItems(hotel.id, garstufe.id, [steak.id], "t");
  await setGroupItems(hotel.id, beilage.id, [steak.id], "t");
  return { hotel, steak, order, garstufe, medium, rare, beilage, pilze };
}

describe("Optionen und Menüs (SPEC 19.49)", () => {
  it("Pflichtgruppe, Text, Aufpreis und Sonderwunsch", async () => {
    const s = await setup();
    await expect(addLines(s.hotel, s.order.id, [{ itemId: s.steak.id, quantity: 1 }], "k")).rejects.toThrow(/Garstufe/);
    const [l] = await addLines(s.hotel, s.order.id, [{ itemId: s.steak.id, quantity: 1, optionIds: [s.medium.id, s.pilze.id], note: "ohne Zwiebeln" }], "k");
    expect(l.description).toBe("Entrecôte · medium · Pilze · ohne Zwiebeln");
    expect(l.unitPriceRappen).toBe(4550);
    expect(l.note).toBe("ohne Zwiebeln");
    expect(l.options).toEqual([{ group: "Garstufe", name: "medium", priceRappen: 0 }, { group: "Extras", name: "Pilze", priceRappen: 350 }]);
    expect((await orderView(s.hotel.id, s.order.id))!.openTotalRappen).toBe(4550);
    await expect(addLines(s.hotel, s.order.id, [{ itemId: s.steak.id, quantity: 1, optionIds: [s.medium.id, s.rare.id] }], "k")).rejects.toBeInstanceOf(PosError);
  });

  it("fremde Option wird abgelehnt, mandantengetrennt; ausgeblendete Option fehlt im Katalog", async () => {
    const s = await setup();
    const o = await setup();
    await expect(addLines(s.hotel, s.order.id, [{ itemId: s.steak.id, quantity: 1, optionIds: [o.medium.id] }], "k")).rejects.toThrow(/gehört nicht/);
    expect((await listOptionGroups(o.hotel.id)).every((g) => g.hotelId === o.hotel.id)).toBe(true);
    await setOptionActive(s.hotel.id, s.rare.id, false, "t");
    const cat = await catalogGroups(s.hotel.id, [s.steak.id]);
    expect(cat.get(s.steak.id)!.find((g) => g.name === "Garstufe")!.options.map((x) => x.name)).toEqual(["medium"]);
  });

  it("Offline-Zeile mit Snapshot wird ohne erneute Prüfung übernommen", async () => {
    const s = await setup();
    const [l] = await addLines(s.hotel, s.order.id, [{ itemId: s.steak.id, quantity: 1, optionIds: [], note: "x", snapshot: { description: "Entrecôte · well done", unitPriceRappen: 4200, vatBps: 810 }, optionsSnapshot: [{ group: "Garstufe", name: "well done", priceRappen: 0 }] }], "k");
    expect(l.description).toBe("Entrecôte · well done");
    expect(l.options).toEqual([{ group: "Garstufe", name: "well done", priceRappen: 0 }]);
  });
});
