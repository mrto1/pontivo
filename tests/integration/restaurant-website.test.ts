import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotelModules, hotels } from "../../src/db/schema";
import { ensureHomePage } from "../../src/services/site";
import { daysFromOpening, resolveBlocks } from "../../src/services/site-data";
import { saveItem } from "../../src/services/pos";
import { saveItemOnline } from "../../src/services/online-orders";
import { saveOpeningHours } from "../../src/services/reservations";
import { restaurantJsonLd } from "../../src/lib/structured-data";
import { makeHotel } from "../helpers";

afterAll(closeDb);

describe("Website-Vorlage Restaurant (SPEC 20.7)", () => {
  it("Vorlage beim Anlegen; Speisekarte und Öffnungszeiten aus dem Betrieb; strukturierte Daten", async () => {
    const { hotel } = await makeHotel({}, []);
    await db().update(hotels).set({ propertyType: "restaurant" }).where(eq(hotels.id, hotel.id));
    await db().insert(hotelModules).values({ hotelId: hotel.id, module: "restaurant", enabled: true });
    const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
    const home = await ensureHomePage(h, "t");
    expect(home.blocks.map((b) => b.type)).toEqual(["hero", "reserve", "order", "hours", "menu", "location"]);
    expect(home.blocks[0]).toMatchObject({ showSearch: false });
    const pizza = await saveItem(h.id, null, { category: "Pizza", name: "Margherita", priceRappen: 1800, vatDineInBps: 810, vatTakeawayBps: 260 }, "t");
    await saveItem(h.id, null, { category: "Getränke", name: "Wasser", priceRappen: 400, vatDineInBps: 810, vatTakeawayBps: 260 }, "t");
    await saveItem(h.id, null, { category: "Pizza", name: "Diavola", priceRappen: 2000, vatDineInBps: 810, vatTakeawayBps: 260 }, "t");
    await saveItemOnline(h.id, pizza.id, { online: true, description: "Tomate", photoUrl: null, allergens: ["gluten", "milk"] }, "t");
    await saveOpeningHours(h.id, { "0": [], "1": [{ from: "11:00", to: "14:00" }], "2": [], "3": [], "4": [], "5": [], "6": [{ from: "17:00", to: "23:00" }] }, "t");
    const blocks = await resolveBlocks(h, home.blocks);
    const menu = blocks.find((b) => b.type === "menu");
    if (menu?.type !== "menu") throw new Error("menu");
    const sections = menu.items.map((i) => i.section.de);
    expect(sections.filter((x, i) => sections.indexOf(x) !== i && sections[i - 1] !== x)).toEqual([]); // Rubriken zusammenhängend
    expect(menu.items.find((i) => i.name.de === "Margherita")).toMatchObject({ priceRappen: 1800, text: { de: "Tomate" }, allergens: ["gluten", "milk"] });
    const hours = blocks.find((b) => b.type === "hours");
    if (hours?.type !== "hours") throw new Error("hours");
    expect(hours.days[0]).toEqual([{ from: "11:00", to: "14:00" }]); // Montag
    expect(hours.days[5]).toEqual([{ from: "17:00", to: "23:00" }]); // Samstag
    expect(hours.days[6]).toEqual([]); // Sonntag
    const ld = restaurantJsonLd(h, blocks, "de", "https://x") as Record<string, unknown>;
    expect(JSON.stringify(ld)).toContain("Margherita");
    expect(JSON.stringify(ld)).toContain("Monday");
  });
  it("Öffnungszeiten ohne Angaben: alle Tage geschlossen", () => {
    expect(daysFromOpening(null)).toEqual([[], [], [], [], [], [], []]);
  });
});
