import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotels, pricingEvents } from "../../src/db/schema";
import { addDays, todayIn } from "../../src/domain/dates";
import { adoptSuggestions, holidaySuggestions, importSchoolHolidays } from "../../src/services/holidays";
import { makeHotel } from "../helpers";

afterAll(closeDb);

describe("Feiertage und Schulferien als Vorschlag", () => {
  it("Import aktualisiert statt zu verdoppeln; Vorschläge gelten nur für den Kanton des Betriebs; Übernahme legt Ereignisse an, danach keine Doppel", async () => {
    const { hotel } = await makeHotel({});
    await db().update(hotels).set({ canton: "ZH" }).where(eq(hotels.id, hotel.id));
    const today = todayIn("Europe/Zurich");
    const from = addDays(today, 40), to = addDays(today, 54);
    const name = `Testferien ${from}`;
    const r1 = await importSchoolHolidays(`ZH;${name};${from};${to}\nBE;${name};${from};${to}\nXX;kaputt;1;2`, "t");
    expect(r1.imported).toBe(2); expect(r1.errors).toHaveLength(1);
    await importSchoolHolidays(`ZH;${name};${from};${addDays(to, 1)}`, "t");

    const h = { id: hotel.id, canton: "ZH" };
    const s = await holidaySuggestions(h, today);
    const school = s.filter((x) => x.name === `${name} (ZH)`);
    expect(school).toHaveLength(1);
    expect(school[0].toDay).toBe(addDays(to, 1));
    expect(s.some((x) => x.name.includes("(BE)") && x.name.startsWith(name))).toBe(false);
    expect(s.some((x) => x.kind === "feiertag")).toBe(true);

    // ohne Zuschlag keine Übernahme
    await expect(adoptSuggestions(h, today, [school[0].key], { feiertag: 0, schulferien: 0 }, "t")).rejects.toThrow(/Schulferien/);
    // fremder Schlüssel wird ignoriert
    expect(await adoptSuggestions(h, today, ["feiertag|Erfunden|2030-01-01|2030-01-01"], { feiertag: 10, schulferien: 10 }, "t")).toBe(0);
    const fest = s.find((x) => x.kind === "feiertag")!;
    expect(await adoptSuggestions(h, today, [school[0].key, fest.key, fest.key], { feiertag: 15, schulferien: 8 }, "t")).toBe(2);
    const ev = await db().select().from(pricingEvents).where(eq(pricingEvents.hotelId, hotel.id));
    expect(ev.map((e) => [e.name, e.adjustBps]).sort()).toEqual([[fest.name, 1500], [`${name} (ZH)`, 800]].sort());
    const again = await holidaySuggestions(h, today);
    expect(again.some((x) => x.key === school[0].key || x.key === fest.key)).toBe(false);
  });
});
