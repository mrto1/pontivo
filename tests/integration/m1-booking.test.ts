import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { POST as createBooking } from "../../app/api/bookings/route";
import { db, closeDb } from "../../src/db/client";
import { bookings, channexOutbox, emailOutbox, payments, ratesDays } from "../../src/db/schema";
import { expireHolds, createDirectBooking, BookingError, releaseHold } from "../../src/services/bookings";
import { searchOffers } from "../../src/services/search";
import { setPaymentProvider, type PaymentProvider } from "../../src/payments/provider";
import { addDays, nightsOf } from "../../src/domain/dates";
import { guest, inDays, inv, makeHotel, cardStubs } from "../helpers";

afterAll(async () => {
  setPaymentProvider(null);
  await closeDb();
});

function bookingRequest(host: string, body: Record<string, unknown>, ip: string) {
  return new Request("http://x/api/bookings", {
    method: "POST",
    headers: { host, "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function body(roomTypeId: string, ratePlanId: string, checkin: string, checkout: string, extra: Record<string, unknown> = {}) {
  return {
    room_type_id: roomTypeId, rate_plan_id: ratePlanId, checkin, checkout, adults: 2, children: 0,
    guest: { first_name: "Anna", last_name: "Muster", email: "anna@example.ch", language: "de" },
    terms_accepted: true, ...extra,
  };
}

/** Provider, der nicht sofort bestätigt (Hold bleibt bestehen) */
const holdOnly: PaymentProvider = {
  name: "fake",
  confirmsImmediately: false, ...cardStubs,
  async createCheckout(a) { return { url: "https://checkout.test/" + a.booking.id, sessionId: "cs_" + a.booking.id }; },
  async createPaymentCheckout(a) { return { url: "https://checkout.test/" + a.idempotencyKey, sessionId: "cs_" + a.idempotencyKey }; },
  async refund() { return { refundId: "re_1" }; },
};

describe("M1 Abnahme", () => {
  it("20 parallele Holds auf das letzte freie Zimmer: genau 1 Erfolg, 19× 409, booked = 1", async () => {
    const { hotel, rooms } = await makeHotel({}, [
      { name: "Suite", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 30000 },
    ]);
    const rt = rooms[0].roomType;
    const rp = rooms[0].plans[0];
    const checkin = inDays(20);
    const checkout = addDays(checkin, 2);
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createBooking(bookingRequest(hotel.primaryDomain!, body(rt.id, rp.id, checkin, checkout), `10.0.0.${i}`))),
    );
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(19);
    for (const n of nightsOf(checkin, checkout)) expect((await inv(rt.id, n)).booked).toBe(1);
    const bs = await db().select().from(bookings).where(eq(bookings.hotelId, hotel.id));
    expect(bs).toHaveLength(1);
    expect(bs[0].status).toBe("confirmed"); // Fake-Zahlung bestätigt sofort
  });

  it("Fake-Zahlung: Buchung bestätigt, Zahlung, E-Mails und Outbox", async () => {
    const { hotel, rooms } = await makeHotel();
    const rt = rooms[0].roomType;
    const checkin = inDays(30);
    const res = await createBooking(bookingRequest(hotel.primaryDomain!, body(rt.id, rooms[0].plans[0].id, checkin, addDays(checkin, 2)), "10.1.0.1"));
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.checkout_url).toMatch(/\/b\/.+\?paid=1$/);
    expect(j.reference).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{4}$/);
    const [b] = await db().select().from(bookings).where(eq(bookings.hotelId, hotel.id));
    // Glarus: 2 Erwachsene × 440 × 2 Nächte = 1760; Zimmer 2 × 18000
    expect(b).toMatchObject({ status: "confirmed", roomsTotalRappen: 36000, touristTaxRappen: 1760, totalRappen: 37760, platformFeeRappen: 378 });
    const [p] = await db().select().from(payments).where(eq(payments.bookingId, b.id));
    expect(p).toMatchObject({ status: "succeeded", amountRappen: 37760, applicationFeeRappen: 378 });
    const mails = await db().select().from(emailOutbox).where(eq(emailOutbox.bookingId, b.id));
    expect(mails.map((m) => m.template).sort()).toEqual(["booking_confirmed", "hotel_new_booking", "pre_arrival"]);
    const ob = await db().select().from(channexOutbox).where(and(eq(channexOutbox.hotelId, hotel.id), eq(channexOutbox.kind, "availability")));
    expect(ob[0]).toMatchObject({ roomTypeId: rt.id, dateFrom: checkin, dateTo: addDays(checkin, 1) });
  });

  it("Abgelaufener Hold gibt alle Nächte frei", async () => {
    setPaymentProvider(holdOnly);
    try {
      const { hotel, rooms } = await makeHotel();
      const rt = rooms[0].roomType;
      const checkin = inDays(40);
      const checkout = addDays(checkin, 3);
      const { booking } = await createDirectBooking(hotel, {
        roomTypeId: rt.id, ratePlanId: rooms[0].plans[0].id, checkin, checkout, adults: 2, children: 0, childrenAges: [], guest,
      });
      expect(booking.status).toBe("hold");
      for (const n of nightsOf(checkin, checkout)) expect((await inv(rt.id, n)).booked).toBe(1);
      expect(await expireHolds(new Date())).toBe(0); // noch nicht abgelaufen
      const later = new Date(Date.now() + 33 * 60_000);
      expect(await expireHolds(later)).toBeGreaterThanOrEqual(1);
      for (const n of nightsOf(checkin, checkout)) expect((await inv(rt.id, n)).booked).toBe(0);
      const [b] = await db().select().from(bookings).where(eq(bookings.id, booking.id));
      expect(b.status).toBe("expired");
      // zweites Freigeben ändert nichts
      expect(await releaseHold(booking.id, { reason: "again", actor: "test" })).toBe(false);
      for (const n of nightsOf(checkin, checkout)) expect((await inv(rt.id, n)).booked).toBe(0);
    } finally {
      setPaymentProvider(null);
    }
  });

  it("Checkout-Fehler gibt den Hold sofort frei", async () => {
    setPaymentProvider({ ...holdOnly, async createCheckout() { throw new Error("stripe down"); } });
    try {
      const { hotel, rooms } = await makeHotel();
      const checkin = inDays(45);
      await expect(
        createDirectBooking(hotel, { roomTypeId: rooms[0].roomType.id, ratePlanId: rooms[0].plans[0].id, checkin, checkout: addDays(checkin, 1), adults: 2, children: 0, childrenAges: [], guest }),
      ).rejects.toMatchObject({ code: "payment_unavailable", httpStatus: 502 });
      expect((await inv(rooms[0].roomType.id, checkin)).booked).toBe(0);
    } finally {
      setPaymentProvider(null);
    }
  });

  it("Suche respektiert Mindestnächte, Anreise/Abreise gesperrt, Verkaufsstopp, Personenzahl", async () => {
    const { hotel, rooms } = await makeHotel({}, [
      { name: "Doppel", roomCount: 2, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 18000 },
    ]);
    const rp = rooms[0].plans[0];
    const d = inDays(50);
    const set = (night: string, v: Partial<typeof ratesDays.$inferInsert>) =>
      db().update(ratesDays).set(v).where(and(eq(ratesDays.ratePlanId, rp.id), eq(ratesDays.night, night)));
    const offersFor = async (ci: string, co: string, adults = 2) => {
      const r = await searchOffers(hotel, { checkin: ci, checkout: co, adults, children: 0 }, { ratePlanId: rp.id });
      if (!r.ok) throw new Error(r.error);
      return { n: r.offers.length, reason: r.rejected[0]?.reason };
    };
    expect(await offersFor(d, addDays(d, 1))).toEqual({ n: 1, reason: undefined });
    await set(d, { minStayArrival: 2 });
    expect(await offersFor(d, addDays(d, 1))).toEqual({ n: 0, reason: "min_stay" });
    expect((await offersFor(d, addDays(d, 2))).n).toBe(1);
    await set(d, { minStayArrival: 1, closedToArrival: true });
    expect((await offersFor(d, addDays(d, 1))).reason).toBe("closed_to_arrival");
    await set(d, { closedToArrival: false });
    await set(addDays(d, 1), { closedToDeparture: true });
    expect((await offersFor(d, addDays(d, 1))).reason).toBe("closed_to_departure");
    await set(addDays(d, 1), { closedToDeparture: false, stopSell: true });
    expect((await offersFor(d, addDays(d, 2))).reason).toBe("stop_sell");
    expect((await offersFor(d, addDays(d, 1), 3)).reason).toBe("occupancy");
  });

  it("Kinderalter ist Pflicht, wenn die Kurtaxe Altersgrenzen hat", async () => {
    const { hotel } = await makeHotel();
    const d = inDays(60);
    const r = await searchOffers(hotel, { checkin: d, checkout: addDays(d, 1), adults: 2, children: 1 });
    expect(r).toEqual({ ok: false, error: "child_ages_required" });
    const r2 = await searchOffers(hotel, { checkin: d, checkout: addDays(d, 1), adults: 2, children: 1, childrenAges: [10] });
    expect(r2.ok && r2.offers[0].touristTaxRappen).toBe(440 + 440 + 220);
  });

  it("Hotel mit unbestätigter Kurtaxe ist nicht buchbar", async () => {
    const { hotel } = await makeHotel({ canton: "SG", municipality: "Wildhaus-Alt St. Johann" });
    const d = inDays(10);
    expect(await searchOffers(hotel, { checkin: d, checkout: addDays(d, 1), adults: 2, children: 0 })).toEqual({ ok: false, error: "tourist_tax_unconfirmed" });
  });

  it("Ungültige Eingaben → 400, Hotel im Entwurf → 403", async () => {
    const { hotel, rooms } = await makeHotel({ status: "draft" });
    const d = inDays(10);
    const bad = await createBooking(bookingRequest(hotel.primaryDomain!, { ...body(rooms[0].roomType.id, rooms[0].plans[0].id, d, addDays(d, 1)), terms_accepted: false }, "10.2.0.1"));
    expect(bad.status).toBe(400);
    const draft = await createBooking(bookingRequest(hotel.primaryDomain!, body(rooms[0].roomType.id, rooms[0].plans[0].id, d, addDays(d, 1)), "10.2.0.2"));
    expect(draft.status).toBe(403);
  });

  it("Rate-Limit: 11. POST pro Minute und IP → 429", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push((await createBooking(bookingRequest("unknown.test", {}, "10.9.9.9"))).status);
    }
    expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it("BookingError trägt HTTP-Status", () => {
    expect(new BookingError("sold_out", 409).httpStatus).toBe(409);
  });
});

describe("Mandantentrennung", () => {
  it("Hotel A kann über keine Route Daten von Hotel B lesen oder buchen", async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    const d = inDays(70);
    // Buchung mit Zimmertyp von B über Domain von A → 404, keine Belegung bei B
    const res = await createBooking(bookingRequest(a.hotel.primaryDomain!, body(b.rooms[0].roomType.id, b.rooms[0].plans[0].id, d, addDays(d, 1)), "10.3.0.1"));
    expect(res.status).toBe(404);
    expect((await inv(b.rooms[0].roomType.id, d)).booked).toBe(0);
    // Rateplan von B mit Zimmertyp von A → 404
    const res2 = await createBooking(bookingRequest(a.hotel.primaryDomain!, body(a.rooms[0].roomType.id, b.rooms[0].plans[0].id, d, addDays(d, 1)), "10.3.0.2"));
    expect(res2.status).toBe(404);
    // Slug von B mitsenden, aber Host ist A → Host gewinnt
    const res3 = await createBooking(bookingRequest(a.hotel.primaryDomain!, { ...body(b.rooms[0].roomType.id, b.rooms[0].plans[0].id, d, addDays(d, 1)), hotel: b.hotel.slug }, "10.3.0.3"));
    expect(res3.status).toBe(404);
    // Suche bei A liefert nur Zimmer von A
    const s = await searchOffers(a.hotel, { checkin: d, checkout: addDays(d, 1), adults: 2, children: 0, childrenAges: [] });
    expect(s.ok && s.offers.every((o) => o.roomType.id === a.rooms[0].roomType.id)).toBe(true);
    const s2 = await searchOffers(a.hotel, { checkin: d, checkout: addDays(d, 1), adults: 2, children: 0 }, { roomTypeId: b.rooms[0].roomType.id });
    expect(s2.ok && s2.offers.length).toBe(0);
  });
});
