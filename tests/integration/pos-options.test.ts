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

describe("Küchenbildschirm (SPEC 19.49 Etappe B)", () => {
  it("offene Zeilen je Station, fertig melden, Storno und Mandantentrennung", async () => {
    const { markDone, openTickets, reverseLine } = await import("../../src/services/pos");
    const s = await setup();
    const bier = await saveItem(s.hotel.id, null, { category: "Getränke", name: "Bier", priceRappen: 600, vatDineInBps: 810, vatTakeawayBps: 810, station: "bar" }, "t");
    const wasser = await saveItem(s.hotel.id, null, { category: "Getränke", name: "Wasser", priceRappen: 300, vatDineInBps: 810, vatTakeawayBps: 810, station: "none" }, "t");
    const lines = await addLines(s.hotel, s.order.id, [{ itemId: s.steak.id, quantity: 2, optionIds: [s.medium.id], note: "ohne Zwiebeln" }, { itemId: bier.id, quantity: 1 }, { itemId: wasser.id, quantity: 1 }], "k");
    const k = await openTickets(s.hotel.id, "kitchen");
    expect(k).toHaveLength(1);
    expect(k[0].lines[0].description).toBe("Entrecôte · medium · ohne Zwiebeln");
    expect((await openTickets(s.hotel.id, "bar"))[0].lines.map((l) => l.description)).toEqual(["Bier"]); // Wasser ohne Station fehlt
    expect(await openTickets((await setup()).hotel.id, "kitchen")).toHaveLength(0);
    await markDone(s.hotel.id, [lines[0].id], "koch");
    expect(await openTickets(s.hotel.id, "kitchen")).toHaveLength(0);
    await reverseLine(s.hotel.id, lines[1].id, 1, "Irrtum", "m");
    expect(await openTickets(s.hotel.id, "bar")).toHaveLength(0);
  });
});
