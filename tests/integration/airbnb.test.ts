import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { auditLog, channexChannels, hotels, ratePlans } from "../../src/db/schema";
import { setChannexFetch } from "../../src/integrations/channex/client";
import {
  activateAirbnb,
  airbnbConnectLink,
  airbnbHandleReturn,
  getAirbnbChannel,
  mapAirbnbListing,
  removeAirbnb,
  unmapAirbnbListing,
} from "../../src/integrations/channex/airbnb";
import { makeHotel } from "../helpers";

type Call = { method: string; path: string; body: any };
const calls: Call[] = [];
const GROUP = crypto.randomUUID();
let PROPERTY = "";
const CHANNEL = crypto.randomUUID();
let mapN = 0;

beforeAll(() => {
  process.env.CHANNEX_API_KEY = "test-key";
  setChannexFetch(async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, "");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path, body });
    const reply = (status: number, j: unknown) => ({ status, json: async () => j, text: async () => JSON.stringify(j) });
    if (path.startsWith("/properties/")) return reply(200, { data: { id: "p", relationships: { groups: { data: [{ id: GROUP, type: "group" }] } } } });
    if (path === "/meta/airbnb/connection_link") return reply(200, { data: { type: "connection_link", attributes: { url: "https://www.airbnb.com/oauth2/auth?x=1" } } });
    if (path === `/channels/${CHANNEL}` && init.method === "GET") return reply(200, { data: { id: CHANNEL, attributes: { is_active: false, channel: "AirBNB", properties: [PROPERTY], rate_plans: [] } } });
    if (path.endsWith("/action/listings"))
      return reply(200, { data: { listing_id_dictionary: { values: [
        { id: "111", title: "Chalet Sonnenhang", type: "house", occupancies: [1, 2, 3, 4], synchronization_category: null, city: "Grindelwald", country_code: "CH", quality_status: "ok" },
        { id: "222", title: "Studio", type: "apartment", occupancies: [1, 2], synchronization_category: null, city: "Grindelwald", country_code: "CH", quality_status: "ok" },
      ] } } });
    if (path.endsWith("/mappings") && init.method === "POST") return reply(200, { data: { id: `00000000-0000-4000-8000-00000000000${++mapN}` } });
    if (path.endsWith("/check_readiness")) return reply(200, { data: [], meta: { message: "ok" } });
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
});

async function rental() {
  const h = await makeHotel({}, [
    { name: "Chalet", roomCount: 1, maxAdults: 4, maxChildren: 0, maxOccupancy: 4, basePriceRappen: 30000 },
    { name: "Studio", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 12000 },
  ]);
  PROPERTY = crypto.randomUUID();
  await db().update(hotels).set({ channexPropertyId: PROPERTY, channexEnabled: true }).where(eq(hotels.id, h.hotel.id));
  const plans = [h.rooms[0].plans[0], h.rooms[1].plans[0]];
  const chx = [crypto.randomUUID(), crypto.randomUUID()];
  for (let i = 0; i < 2; i++) await db().update(ratePlans).set({ channexRatePlanId: chx[i] }).where(eq(ratePlans.id, plans[i].id));
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  return { hotel, plans, chx };
}

describe("Airbnb verbinden (Channex OAuth-Link)", () => {
  it("ganzer Ablauf: Link → Rücksprung → Inserate zuordnen → aktivieren → Reservationen laden → entfernen", async () => {
    const { hotel, plans, chx } = await rental();
    const url = await airbnbConnectLink(hotel, "user:t");
    expect(url).toMatch(/^https:\/\/www\.airbnb\.com\//);
    const link = calls.find((c) => c.path === "/meta/airbnb/connection_link")!.body.connection_link;
    expect(link).toMatchObject({
      group_id: GROUP,
      properties: [PROPERTY],
      redirect_uri: `http://localhost:3000/admin/${hotel.id}/channex/airbnb/return`,
      failure_redirect_uri: `http://localhost:3000/admin/${hotel.id}/channex/airbnb/return`,
      settings: { min_stay_type: "Arrival" },
    });
    expect(link.channel_id).toBeUndefined();
    const row = (await getAirbnbChannel(hotel.id))!;
    expect(row.authToken).toBe(link.token);

    // falsches Token wird abgelehnt
    await expect(airbnbHandleReturn(hotel, { success: "true", channel_id: CHANNEL, token: "x".repeat(link.token.length) }, "user:t")).rejects.toThrow(/ungültig/);
    // Abbruch auf Airbnb
    expect(await airbnbHandleReturn(hotel, { success: "false" }, "user:t")).toMatch(/nicht verbunden/);
    // richtiger Rücksprung
    expect(await airbnbHandleReturn(hotel, { success: "true", channel_id: CHANNEL, token: link.token }, "user:t")).toMatch(/verbunden/);
    expect(await getAirbnbChannel(hotel.id)).toMatchObject({ channexChannelId: CHANNEL, status: "inactive", authToken: null });
    // Token nur einmal verwendbar
    await expect(airbnbHandleReturn(hotel, { success: "true", channel_id: CHANNEL, token: link.token }, "user:t")).rejects.toThrow(/ungültig/);

    calls.length = 0;
    await mapAirbnbListing(hotel, "111", plans[0].id, "user:t");
    const post = calls.find((c) => c.path === `/channels/${CHANNEL}/mappings`)!;
    expect(post.body).toEqual({ mapping: { rate_plan_id: chx[0], settings: { listing_id: "111" } } });
    await expect(mapAirbnbListing(hotel, "111", plans[1].id, "user:t")).rejects.toThrow(/schon zugeordnet/);
    await expect(mapAirbnbListing(hotel, "222", plans[0].id, "user:t")).rejects.toThrow(/anderen Inserat/);
    await expect(mapAirbnbListing(hotel, "999", plans[1].id, "user:t")).rejects.toThrow(/nicht im verbundenen/);
    await mapAirbnbListing(hotel, "222", plans[1].id, "user:t");
    expect((await getAirbnbChannel(hotel.id))!.mappings.map((m) => m.listingTitle)).toEqual(["Chalet Sonnenhang", "Studio"]);

    calls.length = 0;
    expect(await activateAirbnb(hotel, "user:t")).toEqual({ loaded: true });
    expect(calls.map((c) => `${c.method} ${c.path} ${c.body ? JSON.stringify(c.body) : ""}`.trim())).toEqual([
      `POST /channels/${CHANNEL}/check_readiness`,
      `POST /channels/${CHANNEL}/activate`,
      `POST /channels/${CHANNEL}/execute/load_future_reservations {"listing_id":"111"}`,
      `POST /channels/${CHANNEL}/execute/load_future_reservations {"listing_id":"222"}`,
    ]);

    // Neu verbinden: Link mit channel_id
    calls.length = 0;
    await airbnbConnectLink(hotel, "user:t");
    expect(calls.find((c) => c.path === "/meta/airbnb/connection_link")!.body.connection_link.channel_id).toBe(CHANNEL);

    // Aufheben, dann entfernen: Zuordnungen löschen → deaktivieren → löschen
    await unmapAirbnbListing(hotel, "222", "user:t");
    calls.length = 0;
    await removeAirbnb(hotel, "user:t");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE /channels/${CHANNEL}/mappings/00000000-0000-4000-8000-000000000001`,
      `POST /channels/${CHANNEL}/deactivate`,
      `DELETE /channels/${CHANNEL}`,
    ]);
    expect(await getAirbnbChannel(hotel.id)).toBeNull();
    const actions = (await db().select().from(auditLog).where(eq(auditLog.hotelId, hotel.id))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["channel.airbnb.link", "channel.airbnb.connected", "channel.airbnb.map", "channel.airbnb.activate", "channel.airbnb.remove"]));
  });

  it("abgelaufener Link wird abgelehnt; Verbindung einer fremden Property wird abgelehnt", async () => {
    const { hotel } = await rental();
    await airbnbConnectLink(hotel, "user:t");
    const token = calls.find((c) => c.path === "/meta/airbnb/connection_link")!.body.connection_link.token;
    await db().update(channexChannels).set({ authExpiresAt: new Date(Date.now() - 1000) }).where(eq(channexChannels.hotelId, hotel.id));
    await expect(airbnbHandleReturn(hotel, { success: "true", channel_id: CHANNEL, token }, "user:t")).rejects.toThrow(/abgelaufen/);

    const other = await rental(); // PROPERTY zeigt jetzt auf das andere Hotel
    await airbnbConnectLink(hotel, "user:t");
    const t2 = calls.filter((c) => c.path === "/meta/airbnb/connection_link").at(-1)!.body.connection_link.token;
    await expect(airbnbHandleReturn(hotel, { success: "true", channel_id: CHANNEL, token: t2 }, "user:t")).rejects.toThrow(/nicht zu diesem Betrieb/);
    expect(await getAirbnbChannel(other.hotel.id)).toBeNull();
  });

  it("Aktivieren erst mit Zuordnung und eingeschaltetem Abgleich", async () => {
    const { hotel, plans } = await rental();
    await airbnbConnectLink(hotel, "user:t");
    const token = calls.filter((c) => c.path === "/meta/airbnb/connection_link").at(-1)!.body.connection_link.token;
    await airbnbHandleReturn(hotel, { success: "true", channel_id: CHANNEL, token }, "user:t");
    await expect(activateAirbnb(hotel, "user:t")).rejects.toThrow(/mindestens ein Inserat/);
    await mapAirbnbListing(hotel, "111", plans[0].id, "user:t");
    await db().update(hotels).set({ channexEnabled: false }).where(eq(hotels.id, hotel.id));
    await expect(activateAirbnb(hotel, "user:t")).rejects.toThrow(/Abgleich einschalten/);
  });
});
