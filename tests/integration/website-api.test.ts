import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, hotelModules } from "../../src/db/schema";
import { createApiKey, revokeApiKey } from "../../src/services/posbridge";
import { GET as hotelGet } from "../../app/api/v1/hotel/route";
import { GET as availGet } from "../../app/api/v1/availability/route";
import { POST as bookPost } from "../../app/api/v1/bookings/route";
import { GET as statusGet } from "../../app/api/v1/bookings/[reference]/route";
import { POST as folioPost } from "../../app/api/v1/folio-items/route";
import { addDays } from "../../src/domain/dates";
import { inDays, makeHotel } from "../helpers";

afterAll(closeDb);
const call = (h: (r: Request, c?: never) => Promise<Response>, url: string, key: string | null, init: RequestInit = {}) =>
  h(new Request(`http://x${url}`, { ...init, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json", ...(init.headers ?? {}) } }));

async function setup(on = true) {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 20000 }]);
  if (on) await db().insert(hotelModules).values({ hotelId: h.hotel.id, module: "api", enabled: true });
  const { key, row } = await createApiKey(h.hotel.id, "Agentur", "t", "website");
  return { ...h, key, row };
}
const bookingBody = (rt: string, rp: string, ci: string, co: string) => ({ room_type_id: rt, rate_plan_id: rp, checkin: ci, checkout: co, adults: 2, children: 0, guest: { first_name: "Anna", last_name: "Muster", email: `a${Math.random().toString(36).slice(2, 8)}@example.ch`, language: "de" }, terms_accepted: true });

describe("Website-Schnittstelle (SPEC 19.22)", () => {
  it("ohne Schlüssel, falscher Zweck, widerrufen oder Modul aus: abgewiesen", async () => {
    const a = await setup();
    expect((await call(hotelGet, "/api/v1/hotel", null)).status).toBe(401);
    expect((await call(hotelGet, "/api/v1/hotel", "pnt_falsch")).status).toBe(401);
    const pos = await createApiKey(a.hotel.id, "Kasse", "t"); // Zweck pos
    expect((await call(hotelGet, "/api/v1/hotel", pos.key)).status).toBe(403);
    expect((await call(folioPost, "/api/v1/folio-items", a.key, { method: "POST", body: "{}" })).status).toBe(403); // Website-Schlüssel an der Kasse
    await revokeApiKey(a.hotel.id, a.row.id, "t");
    expect((await call(hotelGet, "/api/v1/hotel", a.key)).status).toBe(401);
    const off = await setup(false);
    expect((await call(hotelGet, "/api/v1/hotel", off.key)).status).toBe(403);
  });

  it("Stammdaten, Verfügbarkeit mit Preisen, Buchung mit Zahlungslink und Status", async () => {
    const a = await setup();
    const rt = a.rooms[0].roomType, rp = a.rooms[0].plans[0];
    const info = await (await call(hotelGet, "/api/v1/hotel", a.key)).json();
    expect(info.room_types.map((r: { id: string }) => r.id)).toContain(rt.id);
    const ci = inDays(25), co = addDays(ci, 2);
    const av = await call(availGet, `/api/v1/availability?checkin=${ci}&checkout=${co}&adults=2`, a.key);
    expect(av.status).toBe(200);
    const offers = (await av.json()).offers;
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0].total_rappen).toBeGreaterThanOrEqual(40000);
    expect([400, 422]).toContain((await call(availGet, `/api/v1/availability?checkin=${co}&checkout=${ci}`, a.key)).status);
    const r = await call(bookPost, "/api/v1/bookings", a.key, { method: "POST", body: JSON.stringify(bookingBody(rt.id, rp.id, ci, co)) });
    expect(r.status).toBe(201);
    const bk = await r.json();
    expect(bk.reference).toBeTruthy();
    expect(typeof bk.checkout_url).toBe("string");
    const st = await statusGet(new Request(`http://x/api/v1/bookings/${bk.reference}`, { headers: { authorization: `Bearer ${a.key}` } }), { params: Promise.resolve({ reference: bk.reference }) });
    expect(st.status).toBe(200);
    expect((await st.json()).status).toMatch(/pending|confirmed/);
    // ohne Zustimmung zu den AGB keine Buchung
    const noTerms = { ...bookingBody(rt.id, rp.id, ci, co), terms_accepted: false };
    expect((await call(bookPost, "/api/v1/bookings", a.key, { method: "POST", body: JSON.stringify(noTerms) })).status).toBe(400);
  });

  it("Mandantentrennung: Buchung eines anderen Betriebs ist nicht lesbar; Quelle direct", async () => {
    const a = await setup(), b = await setup();
    const ci = inDays(40), co = addDays(ci, 1);
    const r = await call(bookPost, "/api/v1/bookings", a.key, { method: "POST", body: JSON.stringify(bookingBody(a.rooms[0].roomType.id, a.rooms[0].plans[0].id, ci, co)) });
    const ref = (await r.json()).reference as string;
    const [row] = await db().select().from(bookings).where(and(eq(bookings.hotelId, a.hotel.id), eq(bookings.reference, ref)));
    expect(row.source).toBe("direct");
    const own = await statusGet(new Request(`http://x/api/v1/bookings/${ref}`, { headers: { authorization: `Bearer ${a.key}` } }), { params: Promise.resolve({ reference: ref }) });
    expect(own.status).toBe(200);
    const foreign = await statusGet(new Request(`http://x/api/v1/bookings/${ref}`, { headers: { authorization: `Bearer ${b.key}` } }), { params: Promise.resolve({ reference: ref }) });
    expect(foreign.status).toBe(404);
    // fremde Zimmertypen lassen sich nicht buchen
    const cross = await call(bookPost, "/api/v1/bookings", b.key, { method: "POST", body: JSON.stringify(bookingBody(a.rooms[0].roomType.id, a.rooms[0].plans[0].id, ci, co)) });
    expect(cross.status).toBeGreaterThanOrEqual(400);
  });
});
