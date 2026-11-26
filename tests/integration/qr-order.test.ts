import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotelModules, hotels, posOrderLines } from "../../src/db/schema";
import { PosError, saveItem, saveOption, saveOptionGroup, saveTable, setGroupItems } from "../../src/services/pos";
import { saveItemOnline } from "../../src/services/online-orders";
import { saveSettings } from "../../src/services/reservations";
import { orderAtTable, tableBill } from "../../src/services/table-pay";
import { makeHotel } from "../helpers";

afterAll(closeDb);

async function setup(qrOrdering = true) {
  const { hotel } = await makeHotel({}, []);
  await db().insert(hotelModules).values({ hotelId: hotel.id, module: "restaurant", enabled: true });
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  await saveSettings(h.id, { onlineEnabled: true, windows: [{ from: "18:00", to: "20:00" }], durationMin: 90, maxParty: 12, capacity: 50, leadHours: 0, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 24, autoAssign: true, qrOrdering }, "t");
  const steak = await saveItem(h.id, null, { category: "Hauptgang", name: "Entrecôte", priceRappen: 4000, vatDineInBps: 810, vatTakeawayBps: 260 }, "t");
  await saveItemOnline(h.id, steak.id, { online: true, description: "", photoUrl: null, allergens: [] }, "t");
  const g = await saveOptionGroup(h.id, null, { name: "Garstufe", required: true, maxChoices: 1 }, "t");
  const medium = await saveOption(h.id, g.id, { name: "medium", priceRappen: 0 }, "t");
  await setGroupItems(h.id, g.id, [steak.id], "t");
  const cola = await saveItem(h.id, null, { category: "Getränke", name: "Cola", priceRappen: 500, vatDineInBps: 810, vatTakeawayBps: 260 }, "t");
  await saveItemOnline(h.id, cola.id, { online: false, description: "", photoUrl: null, allergens: [] }, "t");
  const hidden = cola; // nicht online → nicht bestellbar
  const table = await saveTable(h.id, "T1", "t");
  return { h, steak, medium, hidden, table };
}

describe("Bestellen am Tisch per QR (SPEC 19.61)", () => {
  it("Bestellung landet auf dem Tisch, Optionen werden geprüft, zweite Bestellung nutzt dieselbe Rechnung", async () => {
    const { h, steak, medium, table } = await setup();
    await expect(orderAtTable(h, table, [{ itemId: steak.id, quantity: 1, optionIds: [], note: "" }])).rejects.toBeInstanceOf(PosError); // Garstufe fehlt
    const a = await orderAtTable(h, table, [{ itemId: steak.id, quantity: 2, optionIds: [medium.id], note: "ohne Pfeffer" }]);
    expect(a.totalRappen).toBe(8000);
    const lines = await db().select().from(posOrderLines).where(eq(posOrderLines.orderId, a.orderId));
    expect(lines.map((l) => l.description)).toEqual(["Entrecôte · medium · ohne Pfeffer"]);
    expect((await tableBill(h.id, table.id)).totalRappen).toBe(8000);
    const b = await orderAtTable(h, table, [{ itemId: steak.id, quantity: 1, optionIds: [medium.id], note: "" }]);
    expect(b.orderId).toBe(a.orderId);
    expect((await tableBill(h.id, table.id)).totalRappen).toBe(12000);
  });

  it("nicht bestellbare Artikel, ausgeschaltet, Fremdtisch und Begrenzung", async () => {
    const { h, hidden, steak, medium, table } = await setup();
    await expect(orderAtTable(h, table, [{ itemId: hidden.id, quantity: 1, optionIds: [], note: "" }])).rejects.toBeInstanceOf(PosError);
    const other = await setup();
    await expect(orderAtTable(h, other.table, [{ itemId: steak.id, quantity: 1, optionIds: [medium.id], note: "" }])).rejects.toBeInstanceOf(PosError);
    const off = await setup(false);
    await expect(orderAtTable(off.h, off.table, [{ itemId: off.steak.id, quantity: 1, optionIds: [off.medium.id], note: "" }])).rejects.toBeInstanceOf(PosError);
    for (let i = 0; i < 5; i++) await orderAtTable(h, table, [{ itemId: steak.id, quantity: 1, optionIds: [medium.id], note: "" }]);
    await expect(orderAtTable(h, table, [{ itemId: steak.id, quantity: 1, optionIds: [medium.id], note: "" }])).rejects.toThrow(/Zu viele/);
  });
});
