import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "../../src/db/client";
import { createDirectBooking } from "../../src/services/bookings";
import { listBookings } from "../../src/services/admin-bookings";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

describe("Buchungsliste: Suche", () => {
  it("findet nach Name, E-Mail und Referenz (Teiltext, ohne Gross-/Kleinschreibung), nur im eigenen Betrieb; % und _ sind keine Platzhalter", async () => {
    const a = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
    const b = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
    const d = inDays(20);
    const mk = (h: typeof a, g: typeof guest) => createDirectBooking(h.hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin: d, checkout: addDays(d, 1), adults: 2, children: 0, childrenAges: [], guest: g, voucherCode: null });
    const x = await mk(a, { ...guest, firstName: "Berta", lastName: "Zürcher-Quelle", email: "berta.q@example.ch" });
    await mk(b, { ...guest, firstName: "Berta", lastName: "Zürcher-Quelle", email: "berta.q@example.ch" });
    const ids = async (q: string) => (await listBookings(a.hotel.id, { q })).map((r) => r.b.id);
    expect(await ids("zürcher")).toEqual([x.booking.id]);
    expect(await ids("BERTA ZÜR")).toEqual([x.booking.id]);
    expect(await ids("berta.q@")).toEqual([x.booking.id]);
    expect(await ids(x.booking.reference.slice(0, 5).toLowerCase())).toContain(x.booking.id);
    expect(await ids("%")).toEqual([]);
    expect(await ids("nichtda")).toEqual([]);
  });
});
