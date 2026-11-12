import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { auditLog, channexChannels, hotels, ratePlans } from "../../src/db/schema";
import { setChannexFetch } from "../../src/integrations/channex/client";
import {
  activateBookingChannel,
  deactivateBookingChannel,
  activateMetaChannel,
  getBookingChannel,
  getMetaChannel,
  probeBookingChannel,
  probeMetaChannel,
  removeMetaChannel,
  saveMetaMapping,
  removeBookingChannel,
  saveBookingMapping,
} from "../../src/integrations/channex/channels";
import { pairKey } from "../../src/integrations/channex/booking-mapping";
import { makeHotel } from "../helpers";

type Call = { method: string; path: string; body: any };
const calls: Call[] = [];
let testSuccess = true;
let readiness: unknown[] = [];
// Jede Anlage liefert eine neue Kanal-ID (die Spalte ist eindeutig; Reste früherer Läufe dürfen nicht stören)
let channelId = "";
const GROUP = crypto.randomUUID();
const ROOM = 586818903;
const RATE = 16385046;

beforeAll(() => {
  process.env.CHANNEX_API_KEY = "test-key";
  setChannexFetch(async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, "");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path, body });
    const reply = (status: number, j: unknown) => ({ status, json: async () => j, text: async () => JSON.stringify(j) });
    if (path === "/channels/test_connection") return reply(200, { data: { success: testSuccess, errors: null } });
    if (path === "/channels/mapping_details")
      return reply(200, { data: { pricing_type: "OBP", rooms: [{ id: ROOM, title: "Double Room", max_children: 0, rates: [{ id: RATE, title: "standard rate", max_persons: 2, occupancies: [1, 2], price_1: null, pricing: "OBP", parent_rate_id: "", readonly: false }] }] } });
    if (path === "/channels/connection_details") return reply(200, { data: { type: "connection_details", attributes: { currency: "EUR" } } });
    if (path.startsWith("/properties/")) return reply(200, { data: { id: "p", relationships: { groups: { data: [{ id: GROUP, type: "group" }] } } } });
    if (path === "/channels" && init.method === "POST") return reply(201, { data: { id: (channelId = crypto.randomUUID()), attributes: { is_active: false } } });
    if (path.endsWith("/check_readiness")) return reply(200, { data: readiness, meta: { message: "ok" } });
    return reply(200, { meta: { message: "Success" } });
  });
});
afterAll(async () => {
  setChannexFetch(null);
  delete process.env.CHANNEX_API_KEY;
  await closeDb();
});
beforeEach(() => {
  calls.length = 0;
  testSuccess = true;
  readiness = [];
});

/** Hotel in Channex angelegt: 1 Zimmertyp (max. 2 Erw.), Tarif pro Person */
async function hotelInChannex(enabled = true) {
  const h = await makeHotel({}, [{ name: "Doppel", roomCount: 3, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 18000 }]);
  await db().update(hotels).set({ channexPropertyId: crypto.randomUUID(), channexEnabled: enabled }).where(eq(hotels.id, h.hotel.id));
  const plan = h.rooms[0].plans[0];
  const chxPlan = crypto.randomUUID();
  await db().update(ratePlans).set({ channexRatePlanId: chxPlan, channexPerPerson: true }).where(eq(ratePlans.id, plan.id));
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  return { hotel, plan, chxPlan };
}

describe("Booking.com verbinden (Channex Channel API)", () => {
  it("ungültige oder nicht akzeptierte Hotel-ID: verständlicher Fehler, nichts gespeichert", async () => {
    const { hotel } = await hotelInChannex();
    await expect(probeBookingChannel(hotel, "abc", "user:t")).rejects.toThrow(/Ziffern/);
    testSuccess = false;
    await expect(probeBookingChannel(hotel, "5868189", "user:t")).rejects.toThrow(/nicht akzeptiert/);
    expect(await getBookingChannel(hotel.id)).toBeNull();
  });

  it("ganzer Ablauf: prüfen → zuordnen → anlegen → aktivieren → Buchungen laden → pausieren → entfernen", async () => {
    const { hotel, plan, chxPlan } = await hotelInChannex();
    const ch = await probeBookingChannel(hotel, " 5868189 ", "user:t");
    expect(ch).toMatchObject({ externalId: "5868189", status: "draft", channexChannelId: null });
    expect(ch.details).toMatchObject({ pricing_type: "OBP", currency: "EUR" });
    expect(calls.map((c) => c.path)).toEqual(["/channels/test_connection", "/channels/mapping_details", "/channels/connection_details"]);
    expect(calls[0].body).toEqual({ channel: "BookingCom", settings: { hotel_id: "5868189" } });

    calls.length = 0;
    await saveBookingMapping(hotel, { [pairKey(ROOM, RATE)]: plan.id }, "user:t");
    const create = calls.find((c) => c.path === "/channels" && c.method === "POST")!;
    expect(create.body).toEqual({
      channel: {
        channel: "BookingCom",
        group_id: GROUP,
        title: `Booking.com – ${hotel.name}`,
        properties: [hotel.channexPropertyId],
        settings: { hotel_id: "5868189" },
        rate_plans: [
          { rate_plan_id: chxPlan, settings: { room_type_code: ROOM, rate_plan_code: RATE, occupancy: 1, pricing_type: "OBP", primary_occ: false, readonly: false } },
          { rate_plan_id: chxPlan, settings: { room_type_code: ROOM, rate_plan_code: RATE, occupancy: 2, pricing_type: "OBP", primary_occ: true, readonly: false } },
        ],
      },
    });
    const [h2] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
    expect(h2.channexGroupId).toBe(GROUP);
    expect(await getBookingChannel(hotel.id)).toMatchObject({ status: "inactive", channexChannelId: channelId });

    // erneut speichern → PUT ersetzt die ganze Zuordnung, kein zweites Anlegen
    calls.length = 0;
    await saveBookingMapping(h2, { [pairKey(ROOM, RATE)]: plan.id }, "user:t");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`PUT /channels/${channelId}`]);
    expect(calls[0].body.channel.rate_plans).toHaveLength(2);

    calls.length = 0;
    expect(await activateBookingChannel(h2, "user:t")).toEqual({ loaded: true });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST /channels/${channelId}/check_readiness`,
      `POST /channels/${channelId}/activate`,
      `POST /channels/${channelId}/execute/load_future_reservations`,
    ]);
    expect((await getBookingChannel(hotel.id))!.status).toBe("active");

    await deactivateBookingChannel(h2, "user:t");
    expect((await getBookingChannel(hotel.id))!.status).toBe("inactive");

    calls.length = 0;
    await removeBookingChannel(h2, "user:t");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`DELETE /channels/${channelId}`]);
    expect(await getBookingChannel(hotel.id)).toBeNull();
    const actions = (await db().select().from(auditLog).where(eq(auditLog.hotelId, hotel.id))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["channel.booking.probe", "channel.booking.mapping", "channel.booking.activate", "channel.booking.remove"]));
  });

  it("Aktivieren nur mit eingeschaltetem Abgleich und ohne offene Probleme", async () => {
    const { hotel, plan } = await hotelInChannex(false);
    await probeBookingChannel(hotel, "6519420", "user:t");
    await saveBookingMapping(hotel, { [pairKey(ROOM, RATE)]: plan.id }, "user:t");
    await expect(activateBookingChannel(hotel, "user:t")).rejects.toThrow(/Abgleich einschalten/);
    await db().update(hotels).set({ channexEnabled: true }).where(eq(hotels.id, hotel.id));
    readiness = [{ id: crypto.randomUUID(), type: "entity", entity: "Channel", relation: "Mapping", error_code: "required" }];
    calls.length = 0;
    await expect(activateBookingChannel(hotel, "user:t")).rejects.toThrow(/Channel Mapping: required/);
    expect(calls.some((c) => c.path.endsWith("/activate"))).toBe(false);
    expect((await getBookingChannel(hotel.id))!.lastError).toMatch(/Mapping/);
  });

  it("andere Hotels sehen die Verbindung nicht; fremde Tarife werden abgelehnt", async () => {
    const a = await hotelInChannex();
    const b = await hotelInChannex();
    await probeBookingChannel(a.hotel, "5868189", "user:t");
    expect(await getBookingChannel(b.hotel.id)).toBeNull();
    await expect(saveBookingMapping(a.hotel, { [pairKey(ROOM, RATE)]: b.plan.id }, "user:t")).rejects.toThrow(/Unbekannter Tarif/);
    const rows = await db().select().from(channexChannels).where(eq(channexChannels.hotelId, a.hotel.id));
    expect(rows).toHaveLength(1);
  });
});

describe("Expedia verbinden (gleicher Ablauf, eigene Einstellungen)", () => {
  it("Kanal Expedia: prüfen, anlegen mit Expedia-Einstellungen, aktivieren, entfernen; Booking.com unberührt", async () => {
    const { hotel, plan, chxPlan } = await hotelInChannex();
    await expect(probeMetaChannel(hotel, "Expedia", "abc", "user:t")).rejects.toThrow(/Expedia Hotel-ID besteht nur aus Ziffern/);
    testSuccess = false;
    await expect(probeMetaChannel(hotel, "Expedia", "12345678", "user:t")).rejects.toThrow(/Expedia hat die Hotel-ID nicht akzeptiert/);
    testSuccess = true;
    await expect(probeMetaChannel(hotel, "Expedia", "12345678", "user:t", { minStayType: "Nonsense" })).rejects.toThrow(/Ungültige Einstellung/);

    calls.length = 0;
    const ch = await probeMetaChannel(hotel, "Expedia", "12345678", "user:t", { minStayType: "Through", bookingAmount: "Total Amount" });
    expect(ch).toMatchObject({ channel: "Expedia", externalId: "12345678", status: "draft" });
    expect(ch.details).toMatchObject({ minStayType: "Through", bookingAmount: "Total Amount" });
    expect(calls[0].body).toEqual({ channel: "Expedia", settings: { hotel_id: "12345678" } });

    calls.length = 0;
    await saveMetaMapping(hotel, "Expedia", { [pairKey(ROOM, RATE)]: plan.id }, "user:t");
    const create = calls.find((c) => c.path === "/channels" && c.method === "POST")!;
    expect(create.body.channel).toMatchObject({
      channel: "Expedia",
      title: `Expedia – ${hotel.name}`,
      settings: { hotel_id: "12345678", min_stay_type: "Through", booking_amount_settings: "Total Amount" },
    });
    expect(create.body.channel.rate_plans[0].rate_plan_id).toBe(chxPlan);

    const [h2] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
    expect(await activateMetaChannel(h2, "Expedia", "user:t")).toEqual({ loaded: true });
    expect((await getMetaChannel(hotel.id, "Expedia"))!.status).toBe("active");
    expect(await getBookingChannel(hotel.id)).toBeNull();

    await removeMetaChannel(h2, "Expedia", "user:t");
    expect(await getMetaChannel(hotel.id, "Expedia")).toBeNull();
    const actions = (await db().select().from(auditLog).where(eq(auditLog.hotelId, hotel.id))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["channel.expedia.probe", "channel.expedia.mapping", "channel.expedia.activate", "channel.expedia.remove"]));
  });

  it("Booking.com und Expedia können gleichzeitig für dasselbe Hotel bestehen", async () => {
    const { hotel } = await hotelInChannex();
    await probeBookingChannel(hotel, "5868189", "user:t");
    await probeMetaChannel(hotel, "Expedia", "12345678", "user:t");
    const rows = await db().select().from(channexChannels).where(eq(channexChannels.hotelId, hotel.id));
    expect(rows.map((r) => r.channel).sort()).toEqual(["BookingCom", "Expedia"]);
  });
});
