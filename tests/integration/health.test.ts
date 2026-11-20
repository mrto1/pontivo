import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotels } from "../../src/db/schema";
import { healthByHotel } from "../../src/services/health";
import { audit } from "../../src/services/audit";
import { createDirectBooking } from "../../src/services/bookings";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

describe("Gesundheits-Ampel: Messwerte aus der Datenbank", () => {
  it("live ohne Stripe ist rot; mit Konto, Karte, Buchung und Admin-Aktivität grün", async () => {
    const { hotel, rooms } = await makeHotel({ horizonDays: 200 });
    await db().update(hotels).set({ status: "live", liveSince: new Date(Date.now() - 90 * 864e5), stripeChargesEnabled: false }).where(eq(hotels.id, hotel.id));
    let h = (await healthByHotel()).get(hotel.id)!;
    expect(h.level).toBe("red");
    expect(h.reasons.map((r) => r.text).join(" ")).toContain("Stripe");
    expect(h.signals.horizonDays).toBeGreaterThan(150);

    await db().update(hotels).set({ stripeChargesEnabled: true, billingPaymentMethodId: "pm_x" }).where(eq(hotels.id, hotel.id));
    await audit(db(), { hotelId: hotel.id, actor: "user:abc", action: "x.y" });
    const live = (await db().select().from(hotels).where(eq(hotels.id, hotel.id)))[0];
    await createDirectBooking(live, { roomTypeId: rooms[0].roomType.id, ratePlanId: rooms[0].plans[0].id, checkin: inDays(30), checkout: inDays(32), adults: 2, children: 0, childrenAges: [], guest });
    h = (await healthByHotel()).get(hotel.id)!;
    expect(h.signals).toMatchObject({ bookings30: 1, idleDays: 0, hasCard: true });
    expect(h.level).toBe("green");
  });
});
