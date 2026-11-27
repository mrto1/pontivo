import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotelModules, hotels } from "../../src/db/schema";
import { FLOWS, TERMS, WAYFINDING } from "../../src/domain/help-content";
import { helpContext } from "../../src/services/help";
import { makeHotel } from "../helpers";

afterAll(closeDb);

const term = (t: string) => TERMS.find((x) => x.term === t)!;

describe("Hilfe je Betrieb (SPEC 19.65)", () => {
  it("Hotel ohne Restaurant: Gastronomie fehlt, steht aber unter «Weitere Funktionen»", async () => {
    const { hotel } = await makeHotel();
    const ctx = await helpContext(hotel, "owner");
    expect(ctx.lodging).toBe(true);
    expect(ctx.dining).toBe(false);
    expect(ctx.more.map((m) => m.key)).toContain("restaurant");
    expect(ctx.more.map((m) => m.key)).not.toContain("owners"); // nur für Ferienwohnungen
    expect(ctx.termShown(term("Zimmertyp"))).toBe(true);
    expect(ctx.termShown(term("Tischplan"))).toBe(false);
    expect(ctx.termMore(term("Tischplan"))).toBe(true);
    const reserve = FLOWS.find((f) => f.key === "f_reserve")!;
    expect(ctx.allowed(reserve.area)).toBe(false);
    expect(ctx.offModule(reserve.area)?.key).toBe("restaurant");
  });

  it("reines Restaurant: keine Zimmer-Themen, keine Zimmer-Funktionen als Vorschlag", async () => {
    const { hotel } = await makeHotel({}, []);
    await db().update(hotels).set({ propertyType: "restaurant" }).where(eq(hotels.id, hotel.id));
    await db().insert(hotelModules).values({ hotelId: hotel.id, module: "restaurant", enabled: true });
    const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
    const ctx = await helpContext(h, "owner");
    expect(ctx.lodging).toBe(false);
    expect(ctx.dining).toBe(true);
    const more = ctx.more.map((m) => m.key);
    for (const k of ["housekeeping", "frontdesk", "groups", "access", "statistics"]) expect(more, k).not.toContain(k);
    expect(more).toContain("pos");
    expect(ctx.termShown(term("Zimmertyp"))).toBe(false);
    expect(ctx.termMore(term("Zimmertyp"))).toBe(false); // gehört nicht zur Betriebsart
    expect(ctx.termShown(term("Tischplan"))).toBe(true);
    expect(WAYFINDING.filter((w) => ctx.inScope(w.scope)).some((w) => w.area === "calendar")).toBe(false);
  });

  it("eingeschränkte Rolle sieht nur ihre Bereiche", async () => {
    const { hotel } = await makeHotel();
    await db().insert(hotelModules).values([{ hotelId: hotel.id, module: "housekeeping", enabled: true }]);
    const ctx = await helpContext(hotel, "housekeeping");
    expect(ctx.allowed("housekeeping")).toBe(true);
    expect(ctx.allowed("invoices")).toBe(false);
  });
});
