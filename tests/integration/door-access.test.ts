import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookingRooms, bookings, doorCodes, hotels, rooms } from "../../src/db/schema";
import { confirmBooking, createDirectBooking } from "../../src/services/bookings";
import { setNukiFetch } from "../../src/integrations/nuki/client";
import { AccessError, accessJob, codesOfBooking, issueCodes, listLocks, revokeCodes, saveNukiToken, setLockRoom, syncLocks } from "../../src/services/door-access";
import { setModule } from "../../src/services/modules";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);
afterEach(() => setNukiFetch(null));

type Auth = { id: string; name: string; type: number; code: number; allowedFromDate: string; allowedUntilDate: string };
/** Nuki-Attrappe: zwei Schlösser; Anlegen antwortet 204, die Liste zeigt die Berechtigung danach */
function fakeNuki(opts: { failCreate?: boolean } = {}) {
  const auths: Record<number, Auth[]> = { 11: [], 22: [] };
  const log: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const path = String(url).replace("https://api.nuki.io", "");
    const method = init?.method ?? "GET";
    log.push(`${method} ${path} ${(init?.headers as Record<string, string>)?.Authorization ?? ""}`);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (path === "/smartlock") return json([{ smartlockId: 11, name: "Haupteingang", type: 4 }, { smartlockId: 22, name: "Zimmer 1", type: 4 }]);
    const m = path.match(/^\/smartlock\/(\d+)\/auth(?:\/(.+))?$/);
    if (!m) return json({}, 404);
    const lock = Number(m[1]);
    if (method === "GET") return json(auths[lock]);
    if (method === "PUT") {
      if (opts.failCreate) return new Response("", { status: 409 });
      const b = JSON.parse(String(init!.body));
      auths[lock].push({ id: `a${lock}${auths[lock].length}`, name: b.name, type: b.type, code: b.code, allowedFromDate: b.allowedFromDate, allowedUntilDate: b.allowedUntilDate });
      return new Response(null, { status: 204 });
    }
    if (method === "DELETE") { auths[lock] = auths[lock].filter((a) => a.id !== m[2]); return new Response(null, { status: 204 }); }
    return json({}, 400);
  }) as unknown as typeof fetch;
  setNukiFetch(f);
  return { auths, log };
}

async function setup() {
  const h = await makeHotel();
  const checkin = inDays(2);
  let hotel = (await db().select().from(hotels).where(eq(hotels.id, h.hotel.id)))[0];
  const { booking } = await createDirectBooking(hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, 2), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
  await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
  const [room] = await db().insert(rooms).values({ hotelId: hotel.id, roomTypeId: h.rooms[0].roomType.id, number: "1" }).returning();
  await db().update(bookingRooms).set({ roomId: room.id }).where(eq(bookingRooms.bookingId, booking.id));
  await setModule(hotel.id, "access", true, "t");
  hotel = (await db().select().from(hotels).where(eq(hotels.id, hotel.id)))[0];
  return { hotel, booking, room };
}

describe("Zutritt mit Nuki (SPEC 18.5)", () => {
  it("Token prüfen, Schlösser laden, Zimmer zuordnen; Token liegt verschlüsselt", async () => {
    const n = fakeNuki();
    const { hotel } = await setup();
    await expect(saveNukiToken(hotel, "kurz", "t")).rejects.toThrow(AccessError);
    await saveNukiToken(hotel, "x".repeat(40), "t");
    const h2 = (await db().select().from(hotels).where(eq(hotels.id, hotel.id)))[0];
    expect(h2.content.nuki?.tokenEnc).toMatch(/^v1:/);
    expect(h2.content.nuki?.tokenEnc).not.toContain("xxxx");
    expect(await syncLocks(h2, "t")).toBe(2);
    expect(n.log.every((l) => l.endsWith("Bearer " + "x".repeat(40)))).toBe(true);
    expect(await listLocks(hotel.id)).toHaveLength(2);
  });

  it("Codes: Eingang + zugewiesenes Zimmer, Gültigkeit, nicht doppelt; Widerruf löscht bei Nuki", async () => {
    const n = fakeNuki();
    const { hotel, booking, room } = await setup();
    await saveNukiToken(hotel, "t".repeat(40), "t");
    const h = (await db().select().from(hotels).where(eq(hotels.id, hotel.id)))[0];
    await syncLocks(h, "t");
    const locks = await listLocks(h.id);
    await setLockRoom(h.id, locks.find((l) => l.name === "Zimmer 1")!.id, room.id, "t");
    const r = await issueCodes(h, booking.id, "t");
    expect(r).toEqual({ created: 2, errors: 0 });
    expect(n.auths[11]).toHaveLength(1);
    expect(n.auths[22]).toHaveLength(1);
    const a = n.auths[11][0];
    expect(a.type).toBe(13);
    expect(a.name).toMatch(/^Pontivo /);
    expect(a.allowedUntilDate > a.allowedFromDate).toBe(true);
    const codes = await codesOfBooking(h.id, booking.id);
    expect(codes.map((c) => c.status)).toEqual(["active", "active"]);
    expect(codes.find((c) => c.lockName === "Haupteingang")!.code).toBe(String(a.code));
    expect(await issueCodes(h, booking.id, "t")).toEqual({ created: 0, errors: 0 }); // idempotent
    expect(n.auths[11]).toHaveLength(1);
    expect(await revokeCodes(h, booking.id, "t")).toBe(2);
    expect(n.auths[11]).toHaveLength(0);
    expect((await codesOfBooking(h.id, booking.id)).every((c) => c.status === "revoked" && c.code === null)).toBe(true);
  });

  it("Zimmertür ohne Zuweisung des Zimmers bekommt keinen Code; unbestätigte Buchung abgelehnt; Fehler wird festgehalten", async () => {
    fakeNuki({ failCreate: true });
    const { hotel, booking, room } = await setup();
    await saveNukiToken(hotel, "t".repeat(40), "t");
    const h = (await db().select().from(hotels).where(eq(hotels.id, hotel.id)))[0];
    await syncLocks(h, "t");
    const locks = await listLocks(h.id);
    const other = (await db().insert(rooms).values({ hotelId: h.id, roomTypeId: room.roomTypeId, number: "9" }).returning())[0];
    await setLockRoom(h.id, locks.find((l) => l.name === "Zimmer 1")!.id, other.id, "t"); // fremdes Zimmer
    const r = await issueCodes(h, booking.id, "t");
    expect(r).toEqual({ created: 0, errors: 1 }); // nur Eingang, Nuki lehnt ab
    const c = await codesOfBooking(h.id, booking.id);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ status: "error", lockName: "Haupteingang" });
    await db().update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    await expect(issueCodes(h, booking.id, "t")).rejects.toThrow(/bestätigte/);
  });

  it("Job: erstellt Codes vor Anreise, zieht sie bei Storno zurück, mandantengetrennt", async () => {
    const n = fakeNuki();
    const { hotel, booking } = await setup();
    await saveNukiToken(hotel, "t".repeat(40), "t");
    const h = (await db().select().from(hotels).where(eq(hotels.id, hotel.id)))[0];
    await syncLocks(h, "t");
    const locks = await listLocks(h.id);
    await setLockRoom(h.id, locks.find((l) => l.name === "Zimmer 1")!.id, (await db().select().from(rooms).where(eq(rooms.hotelId, h.id)))[0].id, "t");
    const o = await setup(); // anderes Hotel ohne Token: wird übersprungen
    expect((await accessJob()).issued).toBeGreaterThanOrEqual(2);
    expect((await codesOfBooking(h.id, booking.id)).length).toBe(2);
    expect(await db().select().from(doorCodes).where(eq(doorCodes.hotelId, o.hotel.id))).toHaveLength(0);
    await db().update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    expect((await accessJob()).revoked).toBeGreaterThanOrEqual(2);
    const name = `Pontivo ${booking.reference}`;
    expect([...n.auths[11], ...n.auths[22]].filter((a) => a.name === name)).toHaveLength(0); // andere Testbetriebe in der DB bleiben unberührt
  });
});
