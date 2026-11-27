import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookingRooms, bookings, guests, posReservations, ratePlans } from "../../src/db/schema";
import { addDays, todayIn } from "../../src/domain/dates";
import { saveTable } from "../../src/services/pos";
import { halfboardJob, syncHalfboard } from "../../src/services/halfboard";
import { saveSettings } from "../../src/services/reservations";
import { makeHotel } from "../helpers";

afterAll(closeDb);

async function setup(board: "half" | "none" = "half") {
  const { hotel, rooms } = await makeHotel();
  const rt = rooms[0].roomType, plan = rooms[0].plans[0];
  await db().update(ratePlans).set({ board }).where(eq(ratePlans.id, plan.id));
  await saveSettings(hotel.id, { onlineEnabled: false, windows: [{ from: "18:00", to: "20:00" }], durationMin: 90, maxParty: 12, capacity: 50, leadHours: 0, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 24, autoAssign: true, halfboardEnabled: true, halfboardTime: "19:00" }, "t");
  await saveTable(hotel.id, "T1", "t");
  const today = todayIn(hotel.timezone);
  const [g] = await db().insert(guests).values({ hotelId: hotel.id, firstName: "Anna", lastName: "Muster", email: "a@example.ch", phone: "+41790000000" }).returning();
  const [b] = await db().insert(bookings).values({ hotelId: hotel.id, reference: `T-${crypto.randomUUID().slice(0, 8)}`, publicToken: crypto.randomUUID().replace(/-/g, ""), source: "direct", status: "confirmed", guestId: g.id,
    checkin: today, checkout: addDays(today, 2), adults: 2, totalRappen: 40000, roomsTotalRappen: 40000, touristTaxRappen: 0, platformFeeRappen: 0 }).returning();
  await db().insert(bookingRooms).values({ bookingId: b.id, hotelId: hotel.id, roomTypeId: rt.id, ratePlanId: plan.id, adults: 2, children: 0, nightlyPrices: [], amountRappen: 40000 });
  return { hotel, b, today };
}

describe("Halbpension mit Tisch (SPEC 19.62)", () => {
  it("legt je Nacht eine Reservation mit Tisch an, ohne Doppel, passt Personen an und storniert bei Stornierung der Buchung", async () => {
    const { hotel, b, today } = await setup();
    expect(await syncHalfboard(hotel, today)).toEqual({ created: 1, updated: 0, cancelled: 0 });
    expect(await syncHalfboard(hotel, today)).toEqual({ created: 0, updated: 0, cancelled: 0 }); // idempotent
    const [r] = await db().select().from(posReservations).where(and(eq(posReservations.hotelId, hotel.id), eq(posReservations.day, today)));
    expect(r).toMatchObject({ time: "19:00", party: 2, name: "Muster Anna", status: "confirmed", bookingId: b.id, email: "" });
    expect(r.tableId).toBeTruthy();
    expect(r.note).toMatch(/Halbpension/);
    expect((await syncHalfboard(hotel, addDays(today, 1))).created).toBe(1);
    expect((await syncHalfboard(hotel, addDays(today, 2))).created).toBe(0); // Abreisetag: keine Nacht
    await db().update(bookingRooms).set({ children: 1 }).where(eq(bookingRooms.bookingId, b.id));
    expect((await syncHalfboard(hotel, today)).updated).toBe(1);
    await db().update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, b.id));
    expect((await syncHalfboard(hotel, today)).cancelled).toBe(1);
    const [c] = await db().select().from(posReservations).where(eq(posReservations.id, r.id));
    expect(c.status).toBe("cancelled");
    expect((await syncHalfboard(hotel, today)).created).toBe(0); // storniert bleibt storniert
  });

  it("Tarif ohne Halbpension und ausgeschaltete Einstellung erzeugen nichts; Job gleicht heute und die nächsten Tage ab", async () => {
    const a = await setup("none");
    expect(await syncHalfboard(a.hotel, a.today)).toEqual({ created: 0, updated: 0, cancelled: 0 });
    const b = await setup();
    expect(await halfboardJob()).toBeGreaterThanOrEqual(2);
    expect(await db().select().from(posReservations).where(eq(posReservations.hotelId, b.hotel.id))).toHaveLength(2);
    await saveSettings(b.hotel.id, { onlineEnabled: false, windows: [{ from: "18:00", to: "20:00" }], durationMin: 90, maxParty: 12, capacity: 50, leadHours: 0, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 24, autoAssign: true, halfboardEnabled: false }, "t");
    expect(await syncHalfboard(b.hotel, addDays(b.today, 1))).toEqual({ created: 0, updated: 0, cancelled: 0 });
  });
});
