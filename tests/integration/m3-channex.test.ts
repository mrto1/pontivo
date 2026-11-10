import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { POST as channexWebhook } from "../../app/api/webhooks/channex/route";
import { db, closeDb } from "../../src/db/client";
import { bookingRooms, bookings, channexOutbox, emailOutbox, hotels, inboundEvents, ratePlans, roomTypes } from "../../src/db/schema";
import { setChannexFetch, type BookingRevision } from "../../src/integrations/channex/client";
import { OutboxState, runOutboxOnce, mergeRanges, backoffMs, enqueueFullSync } from "../../src/integrations/channex/outbox-worker";
import { pullFeed, sourceFromOta } from "../../src/integrations/channex/feed";
import { enableChannex } from "../../src/integrations/channex/connect";
import { signChannex } from "../../src/integrations/channex/signature";
import { setFeedTrigger } from "../../src/jobs/queue";
import { HORIZON_DAYS, updateRates, updateRatesBatch, setBlocked } from "../../src/services/inventory";
import { BookingError, createDirectBooking } from "../../src/services/bookings";
import { createAdminBooking, moveBooking } from "../../src/services/admin-bookings";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, inv, makeHotel } from "../helpers";

type Call = { method: string; path: string; body: any };
const calls: Call[] = [];
let feedQueue: { id: string; type: string; attributes: BookingRevision }[] = [];
let nextStatus: number | null = null;
let nextWarnings: unknown[] = [];

beforeAll(() => {
  process.env.CHANNEX_API_KEY = "test-key";
  process.env.CHANNEX_WEBHOOK_SECRET = "chx-secret";
  setChannexFetch(async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, "");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path, body });
    expect(init.headers["user-api-key"]).toBe("test-key");
    const reply = (status: number, j: unknown) => ({ status, json: async () => j, text: async () => JSON.stringify(j) });
    if (nextStatus) {
      const s = nextStatus;
      nextStatus = null;
      return reply(s, { errors: { code: "http_too_many_requests" } });
    }
    if (path === "/availability" || path === "/restrictions") {
      const w = nextWarnings;
      nextWarnings = [];
      return reply(200, { data: w.length ? [] : [{ id: "task", type: "task" }], meta: { message: "Success", warnings: w } });
    }
    if (path.startsWith("/booking_revisions/feed")) return reply(200, { meta: { total: feedQueue.length, page: 1, limit: 10 }, data: feedQueue.slice(0, 10) });
    const ack = /^\/booking_revisions\/([^/]+)\/ack$/.exec(path);
    if (ack) {
      feedQueue = feedQueue.filter((r) => r.id !== ack[1]);
      return reply(200, { meta: { message: "Success" } });
    }
    return reply(404, { errors: { code: "resource_not_found" } });
  });
});

afterAll(async () => {
  setChannexFetch(null);
  setFeedTrigger(null);
  delete process.env.CHANNEX_API_KEY;
  await closeDb();
});

beforeEach(() => {
  calls.length = 0;
  feedQueue = [];
});

/** Hotel mit Channex-Zuordnung, Abgleich aktiv, Outbox leer */
async function channexHotel() {
  const h = await makeHotel({}, [
    { name: "Doppel", roomCount: 3, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, basePriceRappen: 18000 },
    { name: "Einzel", roomCount: 1, maxAdults: 1, maxChildren: 0, maxOccupancy: 1, basePriceRappen: 12000 },
  ]);
  const prop = crypto.randomUUID();
  await db().update(hotels).set({ channexPropertyId: prop, channexEnabled: true }).where(eq(hotels.id, h.hotel.id));
  const map: Record<string, string> = {};
  for (const r of h.rooms) {
    map[r.roomType.id] = crypto.randomUUID();
    await db().update(roomTypes).set({ channexRoomTypeId: map[r.roomType.id] }).where(eq(roomTypes.id, r.roomType.id));
    for (const p of r.plans) {
      map[p.id] = crypto.randomUUID();
      await db().update(ratePlans).set({ channexRatePlanId: map[p.id] }).where(eq(ratePlans.id, p.id));
    }
  }
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  return { ...h, hotel, prop, map };
}

const mine = (prop: string, path: string) => calls.filter((c) => c.path === path && c.body.values.every((v: any) => v.property_id === prop));

function revision(o: Partial<BookingRevision> & { property_id: string; booking_id: string; room_type_id: string | null; checkin: string; nights: number }): { id: string; type: string; attributes: BookingRevision } {
  const id = crypto.randomUUID();
  const days: Record<string, string> = {};
  for (let i = 0; i < o.nights; i++) days[addDays(o.checkin, i)] = "150.00";
  const attributes: BookingRevision = {
    id,
    property_id: o.property_id,
    booking_id: o.booking_id,
    ota_name: o.ota_name ?? "BookingCom",
    ota_reservation_code: o.ota_reservation_code ?? "9996013801",
    status: o.status ?? "new",
    arrival_date: o.checkin,
    departure_date: addDays(o.checkin, o.nights),
    amount: (150 * o.nights).toFixed(2),
    currency: "CHF",
    occupancy: { adults: 2, children: 0, infants: 0 },
    customer: { name: "Lisa", surname: "Portal", mail: "lisa@guest.booking.com", language: "en" },
    rooms: [
      {
        amount: (150 * o.nights).toFixed(2),
        checkin_date: o.checkin,
        checkout_date: addDays(o.checkin, o.nights),
        room_type_id: o.room_type_id,
        rate_plan_id: null,
        days,
        occupancy: { adults: 2, children: 0, infants: 0 },
      },
    ],
  };
  return { id, type: "booking_revision", attributes };
}

describe("M3 ARI senden", () => {
  it("Preisänderung im Admin → ein gebündelter POST /restrictions mit korrekten Bereichen", async () => {
    const h = await channexHotel();
    const rp = h.rooms[0].plans[0];
    const from = inDays(10);
    // Zwei überlappende Änderungen und eine angrenzende → ein Request, Bereiche nach Wert aufgeteilt
    await updateRates(h.hotel.id, rp.id, from, addDays(from, 4), { priceRappen: 20000 }, { actor: "test" });
    await updateRates(h.hotel.id, rp.id, addDays(from, 2), addDays(from, 6), { priceRappen: 21000 }, { actor: "test" });
    await updateRates(h.hotel.id, rp.id, addDays(from, 7), addDays(from, 7), { stopSell: true }, { actor: "test" });
    await runOutboxOnce(new OutboxState());
    const req = mine(h.prop, "/restrictions");
    expect(req).toHaveLength(1);
    const v = req[0].body.values;
    // Nur geänderte Felder (Channex: kein Snapshot): Preisänderung → nur rate, Verkaufsstopp → nur stop_sell
    expect(v.map((x: any) => [x.date_from, x.date_to, x.rate, x.stop_sell])).toEqual([
      [from, addDays(from, 1), "200.00", undefined],
      [addDays(from, 2), addDays(from, 6), "210.00", undefined],
      [addDays(from, 7), addDays(from, 7), undefined, true],
    ]);
    expect(Object.keys(v[0]).sort()).toEqual(["date_from", "date_to", "property_id", "rate", "rate_plan_id"]);
    expect(v[0]).toMatchObject({ property_id: h.prop, rate_plan_id: h.map[rp.id] });
    const ob = await db().select().from(channexOutbox).where(eq(channexOutbox.hotelId, h.hotel.id));
    expect(ob.every((o) => o.status === "sent")).toBe(true);
  });

  it("Sammeländerung (mehrere Ratepläne/Zeiträume) → genau ein Request, Task-ID gespeichert", async () => {
    const h = await channexHotel();
    const plans = h.rooms.flatMap((r) => r.plans);
    const from = inDays(20);
    await updateRatesBatch(
      h.hotel.id,
      [
        { ratePlanId: plans[0].id, from, to: from, change: { priceRappen: 33300 } },
        { ratePlanId: plans[plans.length - 1].id, from: addDays(from, 4), to: addDays(from, 8), change: { minStayArrival: 3, maxStay: 4, closedToArrival: true } },
      ],
      { actor: "test" },
    );
    await runOutboxOnce(new OutboxState());
    const req = mine(h.prop, "/restrictions");
    expect(req).toHaveLength(1);
    const v = req[0].body.values;
    expect(v.find((x: any) => x.date_from === from && x.rate_plan_id === h.map[plans[0].id]).rate).toBe("333.00");
    const restr = v.find((x: any) => x.date_from === addDays(from, 4));
    expect(restr).toMatchObject({ date_to: addDays(from, 8), min_stay_arrival: 3, max_stay: 4, closed_to_arrival: true });
    expect(restr).not.toHaveProperty("rate");
    expect(restr).not.toHaveProperty("stop_sell");
    const ob = await db().select().from(channexOutbox).where(eq(channexOutbox.hotelId, h.hotel.id));
    expect(ob.every((o) => o.taskId === "task")).toBe(true);
  });

  it("Tarif per_person → POST /restrictions mit Preisen je Belegung statt einem Preis", async () => {
    const h = await channexHotel();
    const rp = h.rooms[0].plans[0];
    await db().update(ratePlans).set({ channexPerPerson: true, baseOccupancy: 2, extraAdultRappen: 4000, singleDiscountRappen: 2000 }).where(eq(ratePlans.id, rp.id));
    const from = inDays(10);
    await updateRates(h.hotel.id, rp.id, from, from, { priceRappen: 20000 }, { actor: "test" });
    await runOutboxOnce(new OutboxState());
    const v = mine(h.prop, "/restrictions")[0].body.values;
    expect(v).toHaveLength(1);
    expect(v[0].rate).toBeUndefined();
    // Doppel: max. 2 Erwachsene → 1 Person mit Einzelrabatt, 2 Personen Grundpreis
    expect(v[0].rates).toEqual([
      { occupancy: 1, rate: "180.00" },
      { occupancy: 2, rate: "200.00" },
    ]);
  });

  it("Hold → POST /availability mit reduziertem Wert", async () => {
    const h = await channexHotel();
    const rt = h.rooms[0].roomType;
    const d = inDays(20);
    await createDirectBooking(h.hotel, { roomTypeId: rt.id, ratePlanId: h.rooms[0].plans[0].id, checkin: d, checkout: addDays(d, 2), adults: 2, children: 0, childrenAges: [], guest });
    await runOutboxOnce(new OutboxState());
    const req = mine(h.prop, "/availability");
    expect(req).toHaveLength(1);
    expect(req[0].body.values).toEqual([{ property_id: h.prop, room_type_id: h.map[rt.id], date_from: d, date_to: addDays(d, 1), availability: 2 }]);
  });

  it("Vergangene Tage werden nicht gesendet", async () => {
    const h = await channexHotel();
    await setBlocked(h.hotel.id, h.rooms[1].roomType.id, inDays(0), inDays(2), 1, { actor: "t" });
    await db().update(channexOutbox).set({ dateFrom: inDays(-5) }).where(eq(channexOutbox.hotelId, h.hotel.id));
    await runOutboxOnce(new OutboxState());
    const v = mine(h.prop, "/availability")[0].body.values;
    expect(v[0].date_from).toBe(inDays(0));
    expect(v[0].availability).toBe(0);
  });

  it("Rate Limit wird nie überschritten (500 Änderungen in 1 Minute)", async () => {
    const h = await channexHotel();
    const rp = h.rooms[0].plans[0];
    const rt = h.rooms[0].roomType;
    const state = new OutboxState();
    const start = Date.now();
    const sentAt: { t: number; path: string }[] = [];
    // 120 Sekunden lang jede Sekunde ~4 Änderungen und einen Worker-Durchlauf (statt alle 6 s → Limiter muss greifen)
    let changes = 0;
    for (let s = 0; s < 120; s++) {
      const now = new Date(start + s * 1000);
      if (changes < 500) {
        for (let k = 0; k < 5 && changes < 500; k++, changes++) {
          const d = inDays(5 + (changes % 60));
          if (changes % 2) await updateRates(h.hotel.id, rp.id, d, d, { priceRappen: 15000 + changes }, { actor: "t" });
          else await setBlocked(h.hotel.id, rt.id, d, d, changes % 3, { actor: "t" });
        }
      }
      await db().update(channexOutbox).set({ nextAttemptAt: now }).where(and(eq(channexOutbox.hotelId, h.hotel.id), eq(channexOutbox.status, "pending")));
      const before = calls.length;
      await runOutboxOnce(state, now);
      for (const c of calls.slice(before)) if (c.body?.values?.[0]?.property_id === h.prop) sentAt.push({ t: now.getTime(), path: c.path });
    }
    expect(changes).toBe(500);
    for (const path of ["/availability", "/restrictions"]) {
      const ts = sentAt.filter((x) => x.path === path).map((x) => x.t);
      expect(ts.length).toBeGreaterThan(5);
      for (const t of ts) expect(ts.filter((u) => u > t - 60_000 && u <= t).length).toBeLessThanOrEqual(10);
    }
    // Am Ende ist alles gesendet
    await runOutboxOnce(state, new Date(start + 200_000));
    const pending = await db().select().from(channexOutbox).where(and(eq(channexOutbox.hotelId, h.hotel.id), eq(channexOutbox.status, "pending")));
    expect(pending).toHaveLength(0);
  }, 120_000);

  it("429 → Pause und Wiederholung mit Backoff", async () => {
    const h = await channexHotel();
    await setBlocked(h.hotel.id, h.rooms[0].roomType.id, inDays(3), inDays(3), 1, { actor: "t" });
    const state = new OutboxState();
    const now = new Date();
    nextStatus = 429;
    await runOutboxOnce(state, now);
    const [e] = await db().select().from(channexOutbox).where(eq(channexOutbox.hotelId, h.hotel.id));
    expect(e.status).toBe("pending");
    expect(e.nextAttemptAt.getTime()).toBe(now.getTime() + 60_000);
    calls.length = 0;
    await runOutboxOnce(state, new Date(now.getTime() + 30_000));
    expect(mine(h.prop, "/availability")).toHaveLength(0); // pausiert
    await runOutboxOnce(state, new Date(now.getTime() + 61_000));
    expect(mine(h.prop, "/availability")).toHaveLength(1);
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(20)).toBe(30 * 60_000);
  });

  it("Validierungsfehler (meta.warnings) → failed + Alarm", async () => {
    const h = await channexHotel();
    await updateRates(h.hotel.id, h.rooms[0].plans[0].id, inDays(3), inDays(3), { priceRappen: 100 }, { actor: "t" });
    nextWarnings = [{ warning: { rate: ["must be greater than 0"] } }];
    await runOutboxOnce(new OutboxState());
    const [e] = await db().select().from(channexOutbox).where(eq(channexOutbox.hotelId, h.hotel.id));
    expect(e.status).toBe("failed");
    const alerts = await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, h.hotel.id), eq(emailOutbox.template, "channex_alert")));
    expect(alerts).toHaveLength(1);
  });

  it("Einschalten erzeugt Vollabgleich für alle gemappten Zimmer und Ratepläne", async () => {
    const h = await channexHotel();
    await db().update(hotels).set({ channexEnabled: false }).where(eq(hotels.id, h.hotel.id));
    await enableChannex(h.hotel, "user:t");
    const ob = await db().select().from(channexOutbox).where(eq(channexOutbox.hotelId, h.hotel.id));
    expect(ob.filter((o) => o.kind === "availability")).toHaveLength(2);
    expect(ob.filter((o) => o.kind === "restrictions")).toHaveLength(4);
    await runOutboxOnce(new OutboxState());
    expect(mine(h.prop, "/availability")[0].body.values.length).toBeGreaterThanOrEqual(2);
    // Channex-Zertifizierung Test 1: Vollabgleich = genau ein Request je Art, ganzer Horizont
    expect(mine(h.prop, "/availability")).toHaveLength(1);
    expect(mine(h.prop, "/restrictions")).toHaveLength(1);
    const r = mine(h.prop, "/restrictions")[0].body.values;
    // Vollabgleich: alle Felder
    expect(r[0]).toMatchObject({ min_stay_arrival: expect.any(Number), max_stay: expect.any(Number), closed_to_arrival: false, closed_to_departure: false, stop_sell: false });
    expect(r.every((v: any) => v.date_to <= inDays(HORIZON_DAYS - 1))).toBe(true);
    expect(r.some((v: any) => v.date_to === inDays(HORIZON_DAYS - 1))).toBe(true);
  });

  it("Hotels ohne Channex: Einträge werden übersprungen, nichts gesendet", async () => {
    const h = await makeHotel();
    await setBlocked(h.hotel.id, h.rooms[0].roomType.id, inDays(3), inDays(3), 1, { actor: "t" });
    await runOutboxOnce(new OutboxState());
    const [e] = await db().select().from(channexOutbox).where(eq(channexOutbox.hotelId, h.hotel.id));
    expect(e.status).toBe("sent");
    expect(e.lastError).toMatch(/übersprungen/);
  });

  it("mergeRanges", () => {
    expect(mergeRanges([["2026-12-05", "2026-12-06"], ["2026-12-01", "2026-12-03"], ["2026-12-04", "2026-12-04"], ["2026-12-10", "2026-12-10"]])).toEqual([
      ["2026-12-01", "2026-12-06"],
      ["2026-12-10", "2026-12-10"],
    ]);
  });
});

describe("M3 Buchungen empfangen", () => {
  it("Revision new → Buchung angelegt, Nächte belegt, Ack gesendet", async () => {
    const h = await channexHotel();
    const rt = h.rooms[0].roomType;
    const d = inDays(30);
    const rev = revision({ property_id: h.prop, booking_id: crypto.randomUUID(), room_type_id: h.map[rt.id], checkin: d, nights: 2 });
    feedQueue = [rev];
    const r = await pullFeed();
    expect(r).toEqual({ acked: 1, failed: 0 });
    expect(calls.some((c) => c.path === `/booking_revisions/${rev.id}/ack`)).toBe(true);
    const [b] = await db().select().from(bookings).where(eq(bookings.channexBookingId, rev.attributes.booking_id));
    expect(b).toMatchObject({ source: "booking_com", status: "confirmed", checkin: d, checkout: addDays(d, 2), totalRappen: 30000, platformFeeRappen: 0, otaReservationCode: "9996013801", language: "en", overbooked: false });
    const [room] = await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, b.id));
    expect(room.nightlyPrices).toEqual([{ night: d, price_rappen: 15000 }, { night: addDays(d, 1), price_rappen: 15000 }]);
    expect((await inv(rt.id, d)).booked).toBe(1);
    expect((await inv(rt.id, addDays(d, 1))).booked).toBe(1);
    expect((await inv(rt.id, addDays(d, 2))).booked).toBe(0);
    const mails = await db().select().from(emailOutbox).where(eq(emailOutbox.bookingId, b.id));
    expect(mails.map((m) => m.template)).toEqual(["hotel_new_booking"]);
    // Verfügbarkeit geht zurück an Channex
    await runOutboxOnce(new OutboxState());
    expect(mine(h.prop, "/availability")[0].body.values[0]).toMatchObject({ date_from: d, date_to: addDays(d, 1), availability: 2 });
  });

  it("modified verschiebt Nächte, cancelled gibt sie frei", async () => {
    const h = await channexHotel();
    const rt = h.rooms[0].roomType;
    const d = inDays(40);
    const bid = crypto.randomUUID();
    feedQueue = [revision({ property_id: h.prop, booking_id: bid, room_type_id: h.map[rt.id], checkin: d, nights: 2 })];
    await pullFeed();
    const d2 = addDays(d, 1);
    feedQueue = [revision({ property_id: h.prop, booking_id: bid, room_type_id: h.map[rt.id], checkin: d2, nights: 3, status: "modified" })];
    await pullFeed();
    expect((await inv(rt.id, d)).booked).toBe(0);
    for (let i = 0; i < 3; i++) expect((await inv(rt.id, addDays(d2, i))).booked).toBe(1);
    const [b] = await db().select().from(bookings).where(eq(bookings.channexBookingId, bid));
    expect(b).toMatchObject({ checkin: d2, checkout: addDays(d2, 3), totalRappen: 45000, status: "confirmed" });
    expect(await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, b.id))).toHaveLength(1);

    feedQueue = [revision({ property_id: h.prop, booking_id: bid, room_type_id: h.map[rt.id], checkin: d2, nights: 3, status: "cancelled" })];
    expect(await pullFeed()).toEqual({ acked: 1, failed: 0 });
    for (let i = 0; i < 3; i++) expect((await inv(rt.id, addDays(d2, i))).booked).toBe(0);
    const [c] = await db().select().from(bookings).where(eq(bookings.channexBookingId, bid));
    expect(c.status).toBe("cancelled");
  });

  it("Unbekanntes Mapping → kein Ack, Alarm, Fehler in inbound_events; spätere Revision derselben Buchung wartet", async () => {
    const h = await channexHotel();
    const bid = crypto.randomUUID();
    const bad = revision({ property_id: h.prop, booking_id: bid, room_type_id: crypto.randomUUID(), checkin: inDays(50), nights: 1 });
    const later = revision({ property_id: h.prop, booking_id: bid, room_type_id: h.map[h.rooms[0].roomType.id], checkin: inDays(50), nights: 1, status: "modified" });
    feedQueue = [bad, later];
    expect(await pullFeed()).toEqual({ acked: 0, failed: 2 });
    expect(calls.some((c) => c.path.endsWith("/ack"))).toBe(false);
    const [ev] = await db().select().from(inboundEvents).where(and(eq(inboundEvents.source, "channex"), eq(inboundEvents.eventId, bad.id)));
    expect(ev.error).toMatch(/nicht zugeordnet|keinem Zimmertyp/);
    expect(ev.processedAt).toBeNull();
    const alerts = await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, h.hotel.id), eq(emailOutbox.template, "channex_alert")));
    expect(alerts).toHaveLength(1);
    // Zweiter Lauf: kein zweiter Alarm
    await pullFeed();
    expect(await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, h.hotel.id), eq(emailOutbox.template, "channex_alert")))).toHaveLength(1);
    expect(await db().select().from(bookings).where(eq(bookings.channexBookingId, bid))).toHaveLength(0);
  });

  it("Bereits verarbeitete Revision wird nur noch geackt (keine Doppelbuchung)", async () => {
    const h = await channexHotel();
    const rt = h.rooms[0].roomType;
    const d = inDays(55);
    const rev = revision({ property_id: h.prop, booking_id: crypto.randomUUID(), room_type_id: h.map[rt.id], checkin: d, nights: 1 });
    feedQueue = [rev];
    await pullFeed();
    feedQueue = [rev]; // Ack ging verloren, Channex liefert erneut
    expect(await pullFeed()).toEqual({ acked: 1, failed: 0 });
    expect((await inv(rt.id, d)).booked).toBe(1);
  });

  it("Überbuchung: Buchung wird trotzdem gespeichert, markiert und gemeldet", async () => {
    const h = await channexHotel();
    const single = h.rooms[1].roomType; // 1 Zimmer
    const d = inDays(60);
    await createDirectBooking(h.hotel, { roomTypeId: single.id, ratePlanId: h.rooms[1].plans[0].id, checkin: d, checkout: addDays(d, 1), adults: 1, children: 0, childrenAges: [], guest });
    feedQueue = [revision({ property_id: h.prop, booking_id: crypto.randomUUID(), room_type_id: h.map[single.id], checkin: d, nights: 1, ota_name: "A-Expedia" })];
    await pullFeed();
    expect((await inv(single.id, d)).booked).toBe(2);
    const [b] = await db().select().from(bookings).where(and(eq(bookings.hotelId, h.hotel.id), eq(bookings.source, "expedia")));
    expect(b.overbooked).toBe(true);
    const alerts = await db().select().from(emailOutbox).where(and(eq(emailOutbox.bookingId, b.id), eq(emailOutbox.template, "overbooking_alert")));
    expect(alerts.map((a) => a.toEmail).sort()).toEqual(["alarm@example.ch", h.hotel.contactEmail].sort());
  });

  it("Unbekannte Property → kein Ack", async () => {
    feedQueue = [revision({ property_id: crypto.randomUUID(), booking_id: crypto.randomUUID(), room_type_id: crypto.randomUUID(), checkin: inDays(5), nights: 1 })];
    expect(await pullFeed()).toEqual({ acked: 0, failed: 1 });
  });

  it("ota_name → source", () => {
    expect(sourceFromOta("Booking.com")).toBe("booking_com");
    expect(sourceFromOta("BookingCom")).toBe("booking_com");
    expect(sourceFromOta("A-Expedia")).toBe("expedia");
    expect(sourceFromOta("Airbnb")).toBe("airbnb");
    expect(sourceFromOta("Goibibo")).toBe("other_ota");
  });
});

describe("M3 Webhook", () => {
  async function send(body: string, sig?: string, ts?: number) {
    const t = ts ?? Math.floor(Date.now() / 1000);
    return channexWebhook(
      new Request("http://x/api/webhooks/channex", {
        method: "POST",
        headers: { "x-hmac-signature-256": sig ?? signChannex(body, "chx-secret", t), "x-hmac-timestamp": String(t) },
        body,
      }),
    );
  }

  it("Falsche Signatur → 401, alter Zeitstempel → 401, richtige → 202 und Feed-Job", async () => {
    let triggered = 0;
    setFeedTrigger(async () => {
      triggered++;
    });
    const body = JSON.stringify({ event: "booking", property_id: crypto.randomUUID(), payload: {} });
    expect((await send(body, "deadbeef")).status).toBe(401);
    expect((await send(body, signChannex(body, "falsch", Math.floor(Date.now() / 1000)))).status).toBe(401);
    const old = Math.floor(Date.now() / 1000) - 400;
    expect((await send(body, signChannex(body, "chx-secret", old), old)).status).toBe(401);
    expect(triggered).toBe(0);
    expect((await send(body)).status).toBe(202);
    // Schlüsselwechsel: zwei Signaturen, eine passt
    const t = Math.floor(Date.now() / 1000);
    expect((await send(body, `aaaa,${signChannex(body, "chx-secret", t)}`, t)).status).toBe(202);
    expect(triggered).toBe(2);
  });
});

describe("Vollabgleich-Hilfe", () => {
  it("enqueueFullSync ohne Mapping sendet nichts", async () => {
    const h = await makeHotel();
    await enqueueFullSync(h.hotel, "t");
    expect(await db().select().from(channexOutbox).where(eq(channexOutbox.hotelId, h.hotel.id))).toHaveLength(0);
  });
});

describe("Vom Hotel erfasste Buchung (Channex-Live-Test)", () => {
  const guestIn = { firstName: "Peter", lastName: "Telefon", email: "peter@example.ch", language: "de" as const };

  it("Erfassen (1 Nacht) → Verfügbarkeit nur für diese Nacht; Verschieben um 1 Woche → alte und neue Nacht in einem Request", async () => {
    const h = await channexHotel();
    const rt = h.rooms[0].roomType;
    const plan = h.rooms[0].plans[0];
    const d = inDays(30);
    const b = await createAdminBooking(h.hotel, { roomTypeId: rt.id, ratePlanId: plan.id, checkin: d, checkout: addDays(d, 1), adults: 2, guest: guestIn }, "user:t");
    expect(b).toMatchObject({ source: "admin", status: "confirmed", platformFeeRappen: 0, totalRappen: expect.any(Number) });
    expect((await inv(rt.id, d)).booked).toBe(1);
    await runOutboxOnce(new OutboxState());
    const a1 = mine(h.prop, "/availability");
    expect(a1).toHaveLength(1);
    expect(a1[0].body.values).toEqual([{ property_id: h.prop, room_type_id: h.map[rt.id], date_from: d, date_to: d, availability: 2 }]);
    const mails = await db().select().from(emailOutbox).where(eq(emailOutbox.bookingId, b.id));
    expect(mails.map((m) => m.template).sort()).toEqual(["booking_confirmed", "pre_arrival"]);

    calls.length = 0;
    const moved = await moveBooking(h.hotel.id, b.id, addDays(d, 7), { actor: "user:t", notifyGuest: false });
    expect([moved.checkin, moved.checkout]).toEqual([addDays(d, 7), addDays(d, 8)]);
    expect((await inv(rt.id, d)).booked).toBe(0);
    expect((await inv(rt.id, addDays(d, 7))).booked).toBe(1);
    await runOutboxOnce(new OutboxState());
    const a2 = mine(h.prop, "/availability");
    expect(a2).toHaveLength(1);
    expect(a2[0].body.values.map((v: any) => [v.date_from, v.date_to, v.availability])).toEqual([
      [d, d, 3],
      [addDays(d, 7), addDays(d, 7), 2],
    ]);
    const [room] = await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, b.id));
    expect(room.nightlyPrices.map((n) => n.night)).toEqual([addDays(d, 7)]);
    // Erinnerung neu geplant, keine zweite Bestätigung
    const after = await db().select().from(emailOutbox).where(eq(emailOutbox.bookingId, b.id));
    expect(after.filter((m) => m.template === "booking_confirmed")).toHaveLength(1);
    expect(after.filter((m) => m.template === "pre_arrival")).toHaveLength(1);
  });

  it("Verschieben auf ausgebuchte Daten → Fehler, nichts geändert; Portal-Buchungen nicht verschiebbar", async () => {
    const h = await channexHotel();
    const rt = h.rooms[1].roomType; // 1 Zimmer
    const plan = h.rooms[1].plans[0];
    const d = inDays(40);
    const b1 = await createAdminBooking(h.hotel, { roomTypeId: rt.id, ratePlanId: plan.id, checkin: d, checkout: addDays(d, 2), adults: 1, guest: guestIn }, "user:t");
    await createAdminBooking(h.hotel, { roomTypeId: rt.id, ratePlanId: plan.id, checkin: addDays(d, 10), checkout: addDays(d, 11), adults: 1, guest: { ...guestIn, email: "" } }, "user:t");
    await expect(createAdminBooking(h.hotel, { roomTypeId: rt.id, ratePlanId: plan.id, checkin: d, checkout: addDays(d, 1), adults: 1, guest: guestIn }, "user:t")).rejects.toMatchObject({ code: "sold_out" });
    await expect(moveBooking(h.hotel.id, b1.id, addDays(d, 9), { actor: "t", notifyGuest: false })).rejects.toBeInstanceOf(BookingError);
    const [same] = await db().select().from(bookings).where(eq(bookings.id, b1.id));
    expect(same.checkin).toBe(d);
    expect((await inv(rt.id, d)).booked).toBe(1);
    await db().update(bookings).set({ source: "booking_com" }).where(eq(bookings.id, b1.id));
    await expect(moveBooking(h.hotel.id, b1.id, addDays(d, 20), { actor: "t", notifyGuest: false })).rejects.toMatchObject({ code: "ota_booking" });
    // anderes Hotel
    const other = await channexHotel();
    await expect(moveBooking(other.hotel.id, b1.id, addDays(d, 20), { actor: "t", notifyGuest: false })).rejects.toMatchObject({ code: "not_found" });
  });
});
