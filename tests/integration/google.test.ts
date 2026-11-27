import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotelModules, hotels, posReservations } from "../../src/db/schema";
import { addDays, todayIn } from "../../src/domain/dates";
import { actionsCenterFeeds, googleOverview, googleSettings, phoneE164, requestHotelLinks, saveGoogleDining, setHotelLinksStatus, GoogleError } from "../../src/services/google";
import { createReservation, saveSettings } from "../../src/services/reservations";
import { makeHotel } from "../helpers";

afterAll(closeDb);

const reload = async (id: string) => (await db().select().from(hotels).where(eq(hotels.id, id)))[0];

describe("Google (SPEC 19.67)", () => {
  it("Unterkunft: Prüfliste, Anfrage nur vollständig, Plattform schaltet aktiv", async () => {
    const { hotel: h0 } = await makeHotel({}, [{ name: "DZ", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
    const o = await googleOverview(await reload(h0.id));
    expect(o.lodging).toBe(true);
    expect(o.links.bookTemplate).toContain("(CHECKIN_DATE)");
    expect(o.checklist.some((c) => !c.ok)).toBe(true);
    await expect(requestHotelLinks(await reload(h0.id), "t")).rejects.toThrow(GoogleError);
    await setHotelLinksStatus(h0.id, "active", "plattform");
    const s = await googleSettings(h0.id);
    expect(s.hotelLinks).toBe("active");
    expect(s.enabled).toBe(true); // Standard an, bleibt an
  });

  it("Restaurant: Reservieren über Google nur mit Online-Reservation, erscheint im Feed; Herkunft wird gespeichert", async () => {
    const { hotel: h0 } = await makeHotel({}, []);
    await db().update(hotels).set({ propertyType: "restaurant", status: "live", addressLine: "Marktgasse 5", postalCode: "9000", city: "St. Gallen", contactPhone: "071 123 45 67" }).where(eq(hotels.id, h0.id));
    await db().insert(hotelModules).values({ hotelId: h0.id, module: "restaurant", enabled: true });
    let hotel = await reload(h0.id);
    await expect(saveGoogleDining(hotel, { reserve: true, order: false }, "t")).rejects.toThrow(/Online-Reservation/);
    await saveSettings(hotel.id, { onlineEnabled: true, windows: [{ from: "11:00", to: "22:00" }], durationMin: 90, maxParty: 8, capacity: 40, leadHours: 0, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 0, autoAssign: false }, "t");
    hotel = await reload(h0.id);
    await saveGoogleDining(hotel, { reserve: true, order: false }, "t");
    const feeds = await actionsCenterFeeds();
    const mine = feeds.action.data.data.find((a) => a.entity_id === hotel.id);
    expect(mine?.url).toContain("/tisch?ref=google");
    expect(feeds.entity.data.data.find((e) => e.entity_id === hotel.id)?.telephone).toBe("+41711234567");
    const { reservation } = await createReservation(hotel, { day: addDays(todayIn(hotel.timezone), 2), time: "19:00", party: 2, name: "Gast", phone: "079 1", referrer: "google" }, "online", "guest");
    const [r] = await db().select().from(posReservations).where(eq(posReservations.id, reservation.id));
    expect(r.referrer).toBe("google");
    expect((await googleOverview(hotel)).last30.reservations).toBe(1);
  });

  it("Telefonnummer international", () => {
    expect(phoneE164("071 123 45 67")).toBe("+41711234567");
    expect(phoneE164("0041 71 123 45 67")).toBe("+41711234567");
    expect(phoneE164("+41 79 000 00 00")).toBe("+41790000000");
  });
});
