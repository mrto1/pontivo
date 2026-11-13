import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, hotelMembers, hotels, inquiries, users } from "../../src/db/schema";
import { hotelsForUser, roleIn } from "../../src/auth/session";
import { addHotelForUser, registerHost } from "../../src/services/onboarding";
import { portfolio } from "../../src/services/portfolio";
import { createDirectBooking } from "../../src/services/bookings";
import { addDays, todayIn } from "../../src/domain/dates";
import { guest, makeHotel } from "../helpers";

afterAll(closeDb);

const base = { propertyType: "hotel" as const, canton: "BE" as const, municipality: "Thun", mode: "website" as const, acceptTerms: true as const };

describe("Mehrere Betriebe pro Konto", () => {
  it("weiterer Betrieb gehört demselben Konto, mit eigenen Bedingungen; Fremde sehen nichts", async () => {
    const email = `multi-${Date.now()}@example.ch`;
    const first = await registerHost({ ...base, name: "Haus Eins", contactName: "Mia Muster", email });
    const [user] = await db().select().from(users).where(eq(users.email, email));
    const second = await addHotelForUser(user, { ...base, name: "Haus Zwei", propertyType: "apartment" as const });
    expect(second.loginLink).toBeNull();
    expect(second.hotel.id).not.toBe(first.hotel.id);
    expect(second.hotel.slug).not.toBe(first.hotel.slug);
    expect(second.hotel.hostTermsAcceptedAt).not.toBeNull();
    expect(second.hotel.monthlyMinimumRappen).toBeGreaterThan(0);
    // genau ein Benutzer, zwei Mitgliedschaften als Inhaber
    expect(await db().select().from(users).where(eq(users.email, email))).toHaveLength(1);
    const list = await hotelsForUser(user.id);
    expect(list.map((x) => x.hotel.name).sort()).toEqual(["Haus Eins", "Haus Zwei"]);
    expect(list.every((x) => x.role === "owner")).toBe(true);
    // fremder Benutzer
    const other = await registerHost({ ...base, name: "Fremdhaus", contactName: "Otto", email: `other-${Date.now()}@example.ch` });
    const [ou] = await db().select().from(users).where(eq(users.email, other.hotel.contactEmail!));
    expect(await roleIn(ou.id, first.hotel.id)).toBeNull();
    expect((await hotelsForUser(ou.id)).map((x) => x.hotel.name)).toEqual(["Fremdhaus"]);
    // ohne Bedingungen kein Betrieb
    await expect(addHotelForUser(user, { ...base, name: "Haus Drei", acceptTerms: false as never })).rejects.toThrow();
    expect(await db().select().from(hotelMembers).where(eq(hotelMembers.userId, user.id))).toHaveLength(2);
  });

  it("Übersicht zählt je Betrieb nur dessen eigene Daten", async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    const [ha] = await db().select().from(hotels).where(eq(hotels.id, a.hotel.id));
    const [hb] = await db().select().from(hotels).where(eq(hotels.id, b.hotel.id));
    const today = todayIn(ha.timezone);
    // Betrieb A: eine Buchung mit Anreise heute, bestätigt, 2 Nächte
    const { booking } = await createDirectBooking(ha, { roomTypeId: a.rooms[0].roomType.id, ratePlanId: a.rooms[0].plans[0].id, checkin: today, checkout: addDays(today, 2), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
    await db().update(bookings).set({ status: "confirmed", confirmedAt: new Date() }).where(eq(bookings.id, booking.id));
    await db().insert(inquiries).values({ hotelId: ha.id, kind: "stay", name: "X", email: "x@example.ch", message: "Hallo" });
    const [ra, rb] = await portfolio([{ hotel: ha }, { hotel: hb }]);
    expect(ra).toMatchObject({ hotelId: ha.id, arrivals: 1, departures: 0, inHouse: 1, newInquiries: 1, monthBookings: 1 });
    expect(ra.monthRevenueRappen).toBe(booking.totalRappen);
    expect(rb).toMatchObject({ hotelId: hb.id, arrivals: 0, inHouse: 0, newInquiries: 0, monthBookings: 0, monthRevenueRappen: 0 });
  });
});
