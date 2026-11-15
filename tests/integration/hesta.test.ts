import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { guestRegistrations } from "../../src/db/schema";
import { confirmBooking, createDirectBooking } from "../../src/services/bookings";
import { hestaMonth } from "../../src/services/hesta";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

describe("HESTA-Auswertung Service (SPEC 19.8)", () => {
  it("Nationalität aus der Gästemeldung, Rest als unbekannt, Zimmernächte und Mandantentrennung", async () => {
    const h = await makeHotel(), other = await makeHotel();
    const checkin = inDays(40), checkout = addDays(checkin, 2);
    const { booking } = await createDirectBooking(h.hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin, checkout, adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
    await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
    await db().insert(guestRegistrations).values({ hotelId: h.hotel.id, bookingId: booking.id, isPrimary: true, firstName: "Anna", lastName: "Muster", nationality: "DE", arrivalDate: checkin, departureDate: checkout, retentionUntil: addDays(checkout, 365) });
    const m = checkin.slice(0, 7);
    const r = await hestaMonth(h.hotel.id, m);
    const nightsInMonth = [checkin, addDays(checkin, 1)].filter((d) => d.startsWith(m)).length;
    const arrives = checkin.startsWith(m) ? 1 : 0;
    expect(r.rows.find((x) => x.country === "DE")).toEqual({ country: "DE", arrivals: arrives, nights: nightsInMonth });
    expect(r.rows.find((x) => x.country === null)).toEqual({ country: null, arrivals: arrives, nights: nightsInMonth }); // zweite Person ohne Meldung
    expect(r.occupancy.occupiedRoomNights).toBe(nightsInMonth);
    expect(r.occupancy.rooms).toBe(3);
    expect((await hestaMonth(other.hotel.id, m)).rows).toHaveLength(0);
    void eq;
  });
});
