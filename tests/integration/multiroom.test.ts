import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookingRooms, bookings } from "../../src/db/schema";
import { BookingError, cancelBooking, confirmBooking, createDirectBooking, expireHolds, roomsLabel } from "../../src/services/bookings";
import { createAdminBooking } from "../../src/services/admin-bookings";
import { searchOffers } from "../../src/services/search";
import { createInvoiceDraft, invoiceView } from "../../src/services/invoicing";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, inv, makeHotel } from "../helpers";

afterAll(closeDb);

const two = [
  { name: "Doppelzimmer", roomCount: 3, maxAdults: 2, maxChildren: 2, maxOccupancy: 4, basePriceRappen: 18000 },
  { name: "Einzelzimmer", roomCount: 2, maxAdults: 1, maxChildren: 0, maxOccupancy: 1, basePriceRappen: 12000 },
];

describe("Mehrzimmerbuchung (SPEC 19.6)", () => {
  it("Suche mit 2 Zimmern: Personen verteilt, Preise summiert, nur wenn genug frei", async () => {
    const h = await makeHotel({}, two);
    const checkin = inDays(20), checkout = addDays(checkin, 2);
    const one = await searchOffers(h.hotel, { checkin, checkout, adults: 2, children: 0 });
    const multi = await searchOffers(h.hotel, { checkin, checkout, adults: 4, children: 0, rooms: 2 });
    expect(one.ok && multi.ok).toBe(true);
    if (!one.ok || !multi.ok) return;
    const dz1 = one.offers.find((o) => o.roomType.name === "Doppelzimmer")!;
    const dz2 = multi.offers.find((o) => o.roomType.name === "Doppelzimmer")!;
    expect(dz2.roomsTotalRappen).toBe(dz1.roomsTotalRappen * 2);
    expect(dz2.nightlyPrices[0].price_rappen).toBe(dz1.nightlyPrices[0].price_rappen * 2);
    // Einzelzimmer passt nicht für 2 Erwachsene pro Zimmer
    expect(multi.offers.some((o) => o.roomType.name === "Einzelzimmer")).toBe(false);
    // 4 Zimmer: nur 3 Doppelzimmer vorhanden
    const four = await searchOffers(h.hotel, { checkin, checkout, adults: 8, children: 0, rooms: 4 });
    expect(four.ok && four.offers.some((o) => o.roomType.name === "Doppelzimmer")).toBe(false);
  });

  it("Online-Buchung mit 2 gleichen Zimmern: 2 Zeilen, Total = 2 × Preis, Bestand −2, Storno gibt beide frei", async () => {
    const h = await makeHotel({}, two);
    const dz = h.rooms[0];
    const checkin = inDays(20), checkout = addDays(checkin, 2);
    const single = await searchOffers(h.hotel, { checkin, checkout, adults: 2, children: 0 }, { roomTypeId: dz.roomType.id, ratePlanId: dz.plans[0].id });
    if (!single.ok) throw new Error("search");
    const { booking } = await createDirectBooking(h.hotel, { roomTypeId: dz.roomType.id, ratePlanId: dz.plans[0].id, checkin, checkout, adults: 4, children: 0, childrenAges: [], roomCount: 2, guest, voucherCode: null });
    expect(booking.adults).toBe(4);
    expect(booking.totalRappen).toBe(single.offers[0].totalRappen * 2); // gleiche Zimmer, Kurtaxe und Pflicht-Extras je Person bzw. Zimmer
    expect(booking.roomsTotalRappen).toBe(single.offers[0].roomsTotalRappen * 2);
    const rr = await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, booking.id));
    expect(rr).toHaveLength(2);
    expect((await inv(dz.roomType.id, checkin)).booked).toBe(2);
    await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
    await cancelBooking(booking.id, { by: "hotel", actor: "t" });
    expect((await inv(dz.roomType.id, checkin)).booked).toBe(0);
  });

  it("zu wenig frei: 409 und nichts belegt; Hold-Ablauf gibt alle Zimmer frei", async () => {
    const h = await makeHotel({}, two);
    const dz = h.rooms[0];
    const checkin = inDays(20), checkout = addDays(checkin, 1);
    await expect(createDirectBooking(h.hotel, { roomTypeId: dz.roomType.id, ratePlanId: dz.plans[0].id, checkin, checkout, adults: 8, children: 0, childrenAges: [], roomCount: 4, guest, voucherCode: null })).rejects.toBeInstanceOf(BookingError);
    expect((await inv(dz.roomType.id, checkin)).booked).toBe(0);
    const now = new Date();
    const { booking } = await createDirectBooking(h.hotel, { roomTypeId: dz.roomType.id, ratePlanId: dz.plans[0].id, checkin, checkout, adults: 4, children: 0, childrenAges: [], roomCount: 2, guest, voucherCode: null }, { now });
    expect((await inv(dz.roomType.id, checkin)).booked).toBe(2);
    if (!booking) return;
    await db().update(bookings).set({ status: "hold", holdExpiresAt: new Date(now.getTime() - 1000) }).where(eq(bookings.id, booking.id));
    await expireHolds(new Date(now.getTime() + 60 * 60_000));
    expect((await inv(dz.roomType.id, checkin)).booked).toBe(0);
  });

  it("Rezeption: gemischte Zimmer, eigene Belegung, Rechnung mit einer Zeile je Zimmer", async () => {
    const h = await makeHotel({}, two);
    const [dz, ez] = h.rooms;
    const checkin = inDays(20), checkout = addDays(checkin, 2);
    const b = await createAdminBooking(h.hotel, {
      roomTypeId: dz.roomType.id, ratePlanId: dz.plans[0].id, checkin, checkout, adults: 2, children: 0,
      extraRooms: [{ roomTypeId: ez.roomType.id, ratePlanId: ez.plans[0].id, adults: 1, children: 0, childrenAges: [] }],
      guest: { firstName: "Max", lastName: "Muster", email: "", language: "de" }, notifyGuest: false,
    }, "t");
    expect(b.adults).toBe(3);
    expect((await inv(dz.roomType.id, checkin)).booked).toBe(1);
    expect((await inv(ez.roomType.id, checkin)).booked).toBe(1);
    const rr = await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, b.id));
    expect(rr.reduce((a, r) => a + r.amountRappen, 0)).toBe(b.roomsTotalRappen);
    const inv1 = await createInvoiceDraft(h.hotel, b.id, "t");
    const v = await invoiceView(h.hotel, inv1.id);
    expect(v!.lines.filter((l) => l.category === "stay")).toHaveLength(2);
    expect(v!.lines.reduce((a, l) => a + l.amountRappen, 0)).toBe(b.totalRappen);
  });

  it("Zimmernamen für Mails und Seite", () => {
    expect(roomsLabel(["Doppelzimmer", "Doppelzimmer", "Einzelzimmer"])).toBe("2 × Doppelzimmer, Einzelzimmer");
    expect(roomsLabel(["Suite"])).toBe("Suite");
  });
});
