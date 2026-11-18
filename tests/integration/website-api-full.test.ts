import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, hotelModules, hotels, webhookDeliveries } from "../../src/db/schema";
import { createApiKey } from "../../src/services/posbridge";
import { POST as bookPost } from "../../app/api/v1/bookings/route";
import { GET as hotelGet } from "../../app/api/v1/hotel/route";
import { POST as cancelPost, GET as cancelGet } from "../../app/api/v1/bookings/[reference]/cancel/route";
import { GET as openapi } from "../../app/api/v1/openapi.json/route";
import { createEndpoint, deliverDue, saveReturnOrigins, WebhookError, webhookCleanup, type FetchLike } from "../../src/services/webhooks";
import { verifySignature } from "../../src/domain/webhooks";
import { decryptField } from "../../src/lib/guest-crypto";
import { webhookEndpoints } from "../../src/db/schema";
import { setPaymentProvider } from "../../src/payments/provider";
import { addDays } from "../../src/domain/dates";
import { inDays, makeHotel } from "../helpers";

afterAll(async () => { setPaymentProvider(null); await closeDb(); });

async function setup() {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 20000 }]);
  await db().insert(hotelModules).values({ hotelId: h.hotel.id, module: "api", enabled: true });
  const { key, row } = await createApiKey(h.hotel.id, "Agentur", "t", "website");
  return { ...h, key, row };
}
const post = (key: string, body: unknown, headers: Record<string, string> = {}, raw?: string) =>
  bookPost(new Request("http://x/api/v1/bookings", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers }, body: raw ?? JSON.stringify(body) }));
const bk = (rt: string, rp: string, ci: string, co: string, extra: object = {}) => ({ room_type_id: rt, rate_plan_id: rp, checkin: ci, checkout: co, adults: 2, children: 0, guest: { first_name: "Anna", last_name: "Muster", email: "anna@example.ch", language: "de" }, terms_accepted: true, ...extra });
const fetchOk = (calls: { url: string; headers: Record<string, string>; body: string }[], status = 200): FetchLike => async (url, init) => { calls.push({ url, headers: init.headers, body: init.body }); return { status }; };
const pub = async () => ["93.184.216.34"];

describe("Website-Schnittstelle: Idempotenz, Storno, Webhooks, Sicherheit (SPEC 19.22)", () => {
  it("Idempotency-Key: gleiche Anfrage gleiche Antwort ohne zweite Buchung; anderer Inhalt 422; ungültiger Schlüssel 400", async () => {
    const a = await setup();
    const rt = a.rooms[0].roomType.id, rp = a.rooms[0].plans[0].id, ci = inDays(50), co = addDays(ci, 2);
    const body = bk(rt, rp, ci, co);
    const r1 = await post(a.key, body, { "idempotency-key": "abcd-1234-efgh" });
    expect(r1.status).toBe(201);
    const j1 = await r1.json();
    const r2 = await post(a.key, body, { "idempotency-key": "abcd-1234-efgh" });
    expect(r2.status).toBe(201);
    expect(r2.headers.get("idempotent-replayed")).toBe("true");
    expect((await r2.json()).reference).toBe(j1.reference);
    expect(await db().select().from(bookings).where(eq(bookings.hotelId, a.hotel.id))).toHaveLength(1);
    expect((await post(a.key, { ...body, adults: 1 }, { "idempotency-key": "abcd-1234-efgh" })).status).toBe(422);
    expect((await post(a.key, body, { "idempotency-key": "x" })).status).toBe(400);
    // parallel: genau eine Buchung
    const par = await Promise.all(Array.from({ length: 5 }, () => post(a.key, bk(rt, rp, addDays(ci, 10), addDays(ci, 12)), { "idempotency-key": "parallel-key-1" })));
    expect(par.filter((r) => r.status === 201 && r.headers.get("idempotent-replayed") !== "true")).toHaveLength(1);
    expect((await db().select().from(bookings).where(eq(bookings.hotelId, a.hotel.id))).length).toBe(2);
  });

  it("Sicherheit: zu grosser Rumpf 413, Kopfzeilen, Schlüssel mit Ablauf und IP-Liste, return_url nur für erlaubte Ursprünge", async () => {
    const a = await setup();
    expect((await post(a.key, null, {}, "x".repeat(70_000))).status).toBe(413);
    const r = await hotelGet(new Request("http://x/api/v1/hotel", { headers: { authorization: `Bearer ${a.key}` } }));
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const expired = await createApiKey(a.hotel.id, "alt", "t", "website", { expiresAt: new Date(Date.now() - 1000) });
    expect((await hotelGet(new Request("http://x/api/v1/hotel", { headers: { authorization: `Bearer ${expired.key}` } }))).status).toBe(401);
    const ipKey = await createApiKey(a.hotel.id, "ip", "t", "website", { allowedIps: ["203.0.113.7"] });
    const withIp = (ip: string) => hotelGet(new Request("http://x/api/v1/hotel", { headers: { authorization: `Bearer ${ipKey.key}`, "x-forwarded-for": ip } }));
    expect((await withIp("203.0.113.7")).status).toBe(200);
    expect((await withIp("198.51.100.1")).status).toBe(403);
    const rt = a.rooms[0].roomType.id, rp = a.rooms[0].plans[0].id, ci = inDays(60);
    expect((await post(a.key, bk(rt, rp, ci, addDays(ci, 1), { return_url: "https://www.agentur.ch/danke" }))).status).toBe(400);
    const [h] = await db().select().from(hotels).where(eq(hotels.id, a.hotel.id));
    await expect(saveReturnOrigins(h, "http://unsicher.ch", "t")).rejects.toBeInstanceOf(WebhookError);
    await saveReturnOrigins(h, "https://www.agentur.ch", "t");
    expect((await post(a.key, bk(rt, rp, ci, addDays(ci, 1), { return_url: "https://www.agentur.ch/danke" }))).status).toBe(201);
    expect((await post(a.key, bk(rt, rp, addDays(ci, 5), addDays(ci, 6), { return_url: "https://boese.example/danke" }))).status).toBe(400);
  });

  it("Storno über die API: Vorschau, stornieren, Wiederholung unschädlich, fremder Betrieb 404", async () => {
    const a = await setup(), b = await setup();
    const rt = a.rooms[0].roomType.id, rp = a.rooms[0].plans[0].id, ci = inDays(70);
    const ref = (await (await post(a.key, bk(rt, rp, ci, addDays(ci, 2)))).json()).reference as string;
    const ctx = { params: Promise.resolve({ reference: ref }) };
    const req = (key: string, m: string) => new Request(`http://x/api/v1/bookings/${ref}/cancel`, { method: m, headers: { authorization: `Bearer ${key}` } });
    expect((await cancelGet(req(b.key, "GET"), ctx)).status).toBe(404);
    const prev = await (await cancelGet(req(a.key, "GET"), ctx)).json();
    expect(prev.cancellable).toBe(true);
    const c1 = await cancelPost(req(a.key, "POST"), ctx);
    expect(c1.status).toBe(200);
    const c2 = await cancelPost(req(a.key, "POST"), ctx);
    expect((await c2.json()).already_cancelled).toBe(true);
    expect((await db().select().from(bookings).where(and(eq(bookings.hotelId, a.hotel.id), eq(bookings.reference, ref))))[0].status).toBe("cancelled");
  });

  it("Webhooks: Ereignis bei Bestätigung und Storno, signiert, ohne Gästedaten; Wiederholung bei Fehler; interne Ziele gesperrt; Mandantentrennung", async () => {
    const a = await setup(), other = await setup();
    await expect(createEndpoint(a.hotel.id, "http://x.ch/h", [], "t")).rejects.toBeInstanceOf(WebhookError);
    const { secret, row } = await createEndpoint(a.hotel.id, "https://hooks.agentur.ch/pontivo", [], "t");
    await createEndpoint(other.hotel.id, "https://hooks.andere.ch/x", [], "t");
    const [stored] = await db().select().from(webhookEndpoints).where(eq(webhookEndpoints.id, row.id));
    expect(stored.secretEnc).not.toContain(secret); // verschlüsselt gespeichert
    expect(decryptField(stored.secretEnc)).toBe(secret);
    const rt = a.rooms[0].roomType.id, rp = a.rooms[0].plans[0].id, ci = inDays(80);
    const ref = (await (await post(a.key, bk(rt, rp, ci, addDays(ci, 2)))).json()).reference as string; // Fake-Zahlung bestätigt sofort
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const out = await deliverDue({ fetcher: fetchOk(calls), resolver: pub });
    expect(out.sent).toBe(1);
    expect(calls[0].url).toBe("https://hooks.agentur.ch/pontivo");
    expect(calls[0].url).not.toContain("andere");
    expect(verifySignature(secret, calls[0].body, calls[0].headers["pontivo-signature"], Math.floor(Date.now() / 1000))).toBe(true);
    const ev = JSON.parse(calls[0].body);
    expect(ev).toMatchObject({ type: "booking.confirmed", data: { reference: ref, status: "confirmed" } });
    expect(calls[0].body).not.toContain("anna@example.ch");
    // Storno → Ereignis; erster Versuch scheitert (500), zweiter nach Wartezeit klappt
    await cancelPost(new Request(`http://x/api/v1/bookings/${ref}/cancel`, { method: "POST", headers: { authorization: `Bearer ${a.key}` } }), { params: Promise.resolve({ reference: ref }) });
    const fail = await deliverDue({ fetcher: fetchOk([], 500), resolver: pub });
    expect(fail).toMatchObject({ retry: 1, sent: 0 });
    expect((await deliverDue({ fetcher: fetchOk([], 200), resolver: pub })).sent).toBe(0); // noch nicht fällig
    const later = new Date(Date.now() + 2 * 60_000);
    const calls2: typeof calls = [];
    expect((await deliverDue({ now: later, fetcher: fetchOk(calls2), resolver: pub })).sent).toBe(1);
    expect(JSON.parse(calls2[0].body).type).toBe("booking.cancelled");
    // interne Ziele werden nie angefragt
    await createEndpoint(a.hotel.id, "https://intern-ziel.agentur.ch/h", [], "t");
    const ref2 = (await (await post(a.key, bk(rt, rp, addDays(ci, 20), addDays(ci, 21)))).json()).reference as string;
    expect(ref2).toBeTruthy();
    const calls3: typeof calls = [];
    const r3 = await deliverDue({ fetcher: fetchOk(calls3), resolver: async (h) => (h.startsWith("intern") ? ["10.0.0.5"] : ["93.184.216.34"]) });
    expect(calls3.some((c) => c.url.includes("intern-ziel"))).toBe(false);
    expect(r3.retry).toBeGreaterThanOrEqual(1);
    // Mandantentrennung: der andere Betrieb hat keine Zustellung zu diesem Ereignis
    expect(await db().select().from(webhookDeliveries).where(eq(webhookDeliveries.hotelId, other.hotel.id))).toHaveLength(0);
    expect(await webhookCleanup()).toBeGreaterThanOrEqual(0);
  });

  it("OpenAPI ist öffentlich lesbar und nennt die Pfade", async () => {
    const j = await (await openapi()).json();
    expect(Object.keys(j.paths)).toEqual(expect.arrayContaining(["/hotel", "/availability", "/bookings", "/bookings/{reference}", "/bookings/{reference}/cancel"]));
  });
});
