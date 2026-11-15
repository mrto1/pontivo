import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookingRooms, folioItems, hotelModules } from "../../src/db/schema";
import { createAdminBooking } from "../../src/services/admin-bookings";
import { assignRoom, listRooms, seedRooms } from "../../src/services/frontdesk";
import { PosBridgeError, addItemFromPos, authenticate, createApiKey, listApiKeys, revokeApiKey } from "../../src/services/posbridge";
import { POST } from "../../app/api/v1/folio-items/route";
import { addDays, todayIn } from "../../src/domain/dates";
import { makeHotel } from "../helpers";

afterAll(closeDb);

async function setup() {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, basePriceRappen: 15000 }]);
  await seedRooms(h.hotel.id, h.rooms[0].roomType.id, "t");
  const today = todayIn(h.hotel.timezone);
  const b = await createAdminBooking(h.hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin: today, checkout: addDays(today, 2), adults: 2, children: 0, guest: { firstName: "Max", lastName: "Muster", email: "", language: "de" }, notifyGuest: false }, "t");
  const [br] = await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, b.id));
  const rs = await listRooms(h.hotel.id);
  await assignRoom(h.hotel.id, br.id, rs[0].id, "t");
  return { ...h, b, room: rs[0].number, other: rs[1].number };
}
const req = (over: object) => ({ description: "Abendessen", unit_price_rappen: 4850, external_id: "K-" + crypto.randomUUID(), ...over });

describe("PosBridge Service (SPEC 19.15)", () => {
  it("Schlüssel: nur Hash gespeichert, widerrufbar", async () => {
    const h = await makeHotel();
    const { key, row } = await createApiKey(h.hotel.id, "Kasse Restaurant", "t");
    expect(key.startsWith("pnt_")).toBe(true);
    expect(row.keyHash).not.toContain(key);
    expect((await authenticate(key))?.id).toBe(row.id);
    expect(await authenticate("pnt_falsch")).toBeNull();
    await revokeApiKey(h.hotel.id, row.id, "t");
    expect(await authenticate(key)).toBeNull();
    expect((await listApiKeys(h.hotel.id))[0].revokedAt).not.toBeNull();
    await expect(createApiKey(h.hotel.id, " ", "t")).rejects.toBeInstanceOf(PosBridgeError);
  });

  it("bucht über Zimmernummer und Buchungsnummer, idempotent, Konflikt bei anderem Inhalt", async () => {
    const s = await setup();
    const { row } = await createApiKey(s.hotel.id, "K", "t");
    const r1 = await addItemFromPos(row, { quantity: 1, vat: "standard", room_number: s.room, description: "Abendessen", unit_price_rappen: 4850, external_id: "B-1" });
    expect(r1.created).toBe(true);
    expect(r1.bookingReference).toBe(s.b.reference);
    const r2 = await addItemFromPos(row, { quantity: 1, vat: "standard", room_number: s.room, description: "Abendessen", unit_price_rappen: 4850, external_id: "B-1" });
    expect(r2.created).toBe(false);
    expect(r2.item.id).toBe(r1.item.id);
    expect(await db().select().from(folioItems).where(eq(folioItems.bookingId, s.b.id))).toHaveLength(1);
    await expect(addItemFromPos(row, { quantity: 1, vat: "standard", room_number: s.room, description: "Abendessen", unit_price_rappen: 5000, external_id: "B-1" })).rejects.toMatchObject({ code: "conflict" });
    const r3 = await addItemFromPos(row, { quantity: 2, vat: "none", booking_reference: s.b.reference.toLowerCase(), description: "Getränke", unit_price_rappen: 600, external_id: "B-2" });
    expect(r3.created).toBe(true);
    await expect(addItemFromPos(row, { quantity: 1, vat: "standard", room_number: s.other, description: "x", unit_price_rappen: 100, external_id: "B-3" })).rejects.toMatchObject({ code: "not_found" });
    await expect(addItemFromPos(row, { quantity: 1, vat: "standard", booking_reference: "NOPE123", description: "x", unit_price_rappen: 100, external_id: "B-4" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("Mandantentrennung: Schlüssel eines anderen Betriebs findet fremde Buchung nicht", async () => {
    const s = await setup();
    const other = await makeHotel();
    const { row } = await createApiKey(other.hotel.id, "K", "t");
    await expect(addItemFromPos(row, { quantity: 1, vat: "standard", booking_reference: s.b.reference, description: "x", unit_price_rappen: 100, external_id: "X-1" })).rejects.toMatchObject({ code: "not_found" });
    await expect(addItemFromPos(row, { quantity: 1, vat: "standard", room_number: s.room, description: "x", unit_price_rappen: 100, external_id: "X-2" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("HTTP: Schlüssel, Modul, Prüfung, 201 und 200", async () => {
    const s = await setup();
    const { key } = await createApiKey(s.hotel.id, "K", "t");
    const call = (body: unknown, auth: string | null = `Bearer ${key}`) => POST(new Request("http://x/api/v1/folio-items", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }));
    expect((await call(req({ room_number: s.room }), null)).status).toBe(401);
    expect((await call(req({ room_number: s.room }), "Bearer pnt_falsch")).status).toBe(401);
    expect((await call(req({ room_number: s.room }))).status).toBe(403); // Modul aus
    await db().insert(hotelModules).values({ hotelId: s.hotel.id, module: "posbridge", enabled: true }).onConflictDoNothing();
    expect((await call({ description: "x" })).status).toBe(400);
    const body = req({ room_number: s.room });
    const a = await call(body);
    expect(a.status).toBe(201);
    expect(await a.json()).toMatchObject({ booking_reference: s.b.reference, amount_rappen: 4850, duplicate: false });
    const b2 = await call(body);
    expect(b2.status).toBe(200);
    expect((await b2.json()).duplicate).toBe(true);
    expect((await call(req({ room_number: "999" }))).status).toBe(404);
  });
});
