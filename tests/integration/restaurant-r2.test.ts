import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotelModules, hotels, posReservations, sitePages } from "../../src/db/schema";
import { addDays, todayIn } from "../../src/domain/dates";
import { kartei, REGULAR_VISITS, restaurantVisits, saveProfile } from "../../src/services/guest-notes";
import { createReservation, getSettings, saveSettings, slotsFor, tableReservationOnline } from "../../src/services/reservations";
import { ensureHomePage } from "../../src/services/site";
import { makeHotel } from "../helpers";

afterAll(closeDb);

async function withRestaurant(on = true) {
  const { hotel } = await makeHotel();
  if (on) await db().insert(hotelModules).values({ hotelId: hotel.id, module: "restaurant", enabled: true });
  await saveSettings(hotel.id, { ...(await getSettings(hotel.id)), onlineEnabled: true, leadHours: 0, windows: [{ from: "18:00", to: "21:00" }] }, "t");
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  return h;
}

describe("R2-Rest (SPEC 20.2)", () => {
  it("Online-Reservierung nur mit Modul restaurant, ohne Kasse", async () => {
    const day = addDays(todayIn("Europe/Zurich"), 3);
    const off = await withRestaurant(false);
    expect(await tableReservationOnline(off.id)).toBe(false);
    expect(await slotsFor(off, day, 2)).toEqual([]);
    await expect(createReservation(off, { day, time: "18:00", party: 2, name: "X", phone: "1" }, "online", "guest")).rejects.toThrow(/nicht aktiv/);
    const on = await withRestaurant();
    expect(await tableReservationOnline(on.id)).toBe(true);
    const r = await createReservation(on, { day, time: "18:00", party: 2, name: "Gast", phone: "1" }, "online", "guest");
    expect(r.reservation.status).toBe("confirmed");
  });

  it("Kartei: Besuche aus Reservierungen, Stammgast ab 3, Gäste nur aus Reservierungen, Notiz je E-Mail", async () => {
    const h = await withRestaurant();
    const today = todayIn(h.timezone);
    for (let i = 1; i <= REGULAR_VISITS; i++) {
      const r = (await createReservation(h, { day: addDays(today, 2), time: "19:00", party: 2, name: "Frau Treu", email: "Treu@Example.ch" }, "admin", "t")).reservation;
      await db().update(posReservations).set({ day: addDays(today, -i) }).where(eq(posReservations.id, r.id)); // Besuch in der Vergangenheit
    }
    await createReservation(h, { day: addDays(today, 2), time: "19:00", party: 2, name: "Neu", email: "neu@example.ch" }, "admin", "t");
    const v = await restaurantVisits(h.id, ["treu@example.ch", "neu@example.ch"]);
    expect(v.get("treu@example.ch")!.visits).toBe(REGULAR_VISITS);
    expect(v.get("neu@example.ch")!.visits).toBe(0); // noch nicht da gewesen
    await saveProfile(h.id, "treu@example.ch", { note: "ohne Nüsse", tags: "Fensterplatz" }, "t");
    const rows = await kartei(h.id);
    const treu = rows.find((r) => r.email === "treu@example.ch")!;
    expect(treu).toMatchObject({ name: "Frau Treu", stays: 0, visits: REGULAR_VISITS, note: "ohne Nüsse", tags: ["Fensterplatz"] });
    expect(treu.lastVisit).toBe(addDays(today, -1));
    expect((await kartei(h.id, "nüsse")).map((r) => r.email)).toEqual(["treu@example.ch"]);
    // anderer Betrieb sieht nichts
    const other = await withRestaurant();
    expect((await kartei(other.id)).some((r) => r.email === "treu@example.ch")).toBe(false);
  });

  it("Startseite eines reinen Restaurants: ohne Zimmersuche, mit «Tisch reservieren»", async () => {
    const h = await withRestaurant();
    await db().update(hotels).set({ propertyType: "restaurant" }).where(eq(hotels.id, h.id));
    const [hr] = await db().select().from(hotels).where(eq(hotels.id, h.id));
    await db().delete(sitePages).where(and(eq(sitePages.hotelId, h.id), eq(sitePages.slug, "")));
    const p = await ensureHomePage(hr, "t");
    expect(p.blocks.map((b) => b.type)).toEqual(["hero", "reserve"]);
    expect((p.blocks[0] as { showSearch: boolean }).showSearch).toBe(false);
  });
});
