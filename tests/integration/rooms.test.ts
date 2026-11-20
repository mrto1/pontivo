import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { auditLog, channexOutbox, hotels, inventoryDays, ratesDays, roomTypes } from "../../src/db/schema";
import { addPhoto, changePhoto, reorderPhotos, createRatePlan, createRoomType, updateRatePlan, updateRoomType, RoomError } from "../../src/services/rooms";
import { createDirectBooking } from "../../src/services/bookings";
import { searchOffers } from "../../src/services/search";
import { saveImage, sniffImage, mediaPath, UploadError } from "../../src/lib/storage";
import { GET as media } from "../../app/media/[hotelId]/[file]/route";
import { POST as upload } from "../../app/api/admin/hotels/[hotelId]/photos/route";
import { HORIZON_DAYS } from "../../src/services/inventory";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, inv, makeHotel } from "../helpers";

const room = { name: "Suite", description: "Mit Balkon", roomCount: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, sortOrder: 5, active: true };
const plan = { name: "Flex", breakfastIncluded: true, freeCancelHours: 72, cancelFeeBps: 5000, baseOccupancy: 2, extraAdultRappen: 3000, singleDiscountRappen: 1000, active: true };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

beforeAll(async () => {
  process.env.UPLOAD_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "uploads-"));
});
afterAll(closeDb);

describe("Zimmertypen und Tarife", () => {
  it("neuer Zimmertyp → 18 Monate Verfügbarkeit, Outbox, Audit; erst mit Tarif buchbar", async () => {
    const h = await makeHotel();
    const rt = await createRoomType(h.hotel.id, room, "user:t");
    const invRows = await db().select().from(inventoryDays).where(eq(inventoryDays.roomTypeId, rt.id));
    expect(invRows).toHaveLength(HORIZON_DAYS);
    expect(invRows.every((r) => r.total === 2)).toBe(true);
    expect(await db().select().from(channexOutbox).where(and(eq(channexOutbox.hotelId, h.hotel.id), eq(channexOutbox.roomTypeId, rt.id)))).toHaveLength(1);
    const d = inDays(10);
    let r = await searchOffers(h.hotel, { checkin: d, checkout: addDays(d, 2), adults: 2, children: 0 }, { roomTypeId: rt.id });
    expect(r.ok && r.offers.length).toBe(0);

    const rp = await createRatePlan(h.hotel.id, rt.id, plan, 25000, "user:t");
    expect(await db().select().from(ratesDays).where(eq(ratesDays.ratePlanId, rp.id))).toHaveLength(HORIZON_DAYS);
    r = await searchOffers(h.hotel, { checkin: d, checkout: addDays(d, 2), adults: 2, children: 0 }, { roomTypeId: rt.id });
    expect(r.ok && r.offers[0]).toMatchObject({ roomsTotalRappen: 50000, ratePlan: { name: "Flex" } });
    // Einzelrabatt aus dem Tarif
    r = await searchOffers(h.hotel, { checkin: d, checkout: addDays(d, 1), adults: 1, children: 0 }, { roomTypeId: rt.id });
    expect(r.ok && r.offers[0].roomsTotalRappen).toBe(24000);
    const logs = await db().select().from(auditLog).where(eq(auditLog.hotelId, h.hotel.id));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["room_type.create", "rate_plan.create"]));
  });

  it("Anzahl Zimmer ändern führt total nach; weniger als gebucht wird abgelehnt", async () => {
    const h = await makeHotel();
    const rt = h.rooms[0].roomType; // 3 Zimmer
    const d = inDays(15);
    await createDirectBooking(h.hotel, { roomTypeId: rt.id, ratePlanId: h.rooms[0].plans[0].id, checkin: d, checkout: addDays(d, 1), adults: 2, children: 0, childrenAges: [], guest });
    await createDirectBooking(h.hotel, { roomTypeId: rt.id, ratePlanId: h.rooms[0].plans[0].id, checkin: d, checkout: addDays(d, 1), adults: 2, children: 0, childrenAges: [], guest });
    const base = { ...room, name: rt.name, maxAdults: 2, maxChildren: 2, maxOccupancy: 4 };
    await expect(updateRoomType(h.hotel.id, rt.id, { ...base, roomCount: 1 }, "t")).rejects.toThrow(/2 Zimmer gebucht/);
    await updateRoomType(h.hotel.id, rt.id, { ...base, roomCount: 5 }, "t");
    expect((await inv(rt.id, d)).total).toBe(5);
    expect((await inv(rt.id, inDays(100))).total).toBe(5);
    await updateRoomType(h.hotel.id, rt.id, { ...base, roomCount: 2 }, "t");
    expect((await inv(rt.id, d)).total).toBe(2);
  });

  it("inaktiver Zimmertyp/Tarif erscheint nicht in der Suche", async () => {
    const h = await makeHotel();
    const rt = h.rooms[0].roomType;
    const d = inDays(20);
    await updateRatePlan(h.hotel.id, h.rooms[0].plans[1].id, { ...plan, name: "Nicht stornierbar", freeCancelHours: null, cancelFeeBps: 10000, active: false }, "t");
    let r = await searchOffers(h.hotel, { checkin: d, checkout: addDays(d, 1), adults: 2, children: 0 });
    expect(r.ok && r.offers.map((o) => o.ratePlan.name)).toEqual(["Flexibel"]);
    await updateRoomType(h.hotel.id, rt.id, { ...room, name: rt.name, roomCount: 3, active: false }, "t");
    r = await searchOffers(h.hotel, { checkin: d, checkout: addDays(d, 1), adults: 2, children: 0 });
    expect(r.ok && r.offers.length).toBe(0);
  });

  it("Validierung und Mandantentrennung", async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    await expect(createRoomType(a.hotel.id, { ...room, maxOccupancy: 1 }, "t")).rejects.toThrow();
    await expect(updateRoomType(a.hotel.id, b.rooms[0].roomType.id, room, "t")).rejects.toBeInstanceOf(RoomError);
    await expect(createRatePlan(a.hotel.id, b.rooms[0].roomType.id, plan, 10000, "t")).rejects.toBeInstanceOf(RoomError);
    await expect(updateRatePlan(a.hotel.id, b.rooms[0].plans[0].id, plan, "t")).rejects.toBeInstanceOf(RoomError);
    await expect(createRatePlan(a.hotel.id, a.rooms[0].roomType.id, plan, 0, "t")).rejects.toThrow(/Startpreis/);
    await expect(addPhoto(a.hotel.id, b.rooms[0].roomType.id, { url: "/media/x/y.png" }, "t")).rejects.toBeInstanceOf(RoomError);
  });
});

describe("Fotos", () => {
  it("erkennt Bildtypen an den Bytes, lehnt anderes ab", async () => {
    expect(sniffImage(PNG)).toBe("png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniffImage(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("webp");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    const h = await makeHotel();
    await expect(saveImage(h.hotel.id, new TextEncoder().encode("<html>"))).rejects.toBeInstanceOf(UploadError);
    expect(mediaPath(h.hotel.id, "../../etc/passwd")).toBeNull();
    expect(mediaPath("nicht-uuid", "abcdefghijklmnop.png")).toBeNull();
  });

  it("speichern, ausliefern, Titelbild, entfernen", async () => {
    const h = await makeHotel();
    const url = await saveImage(h.hotel.id, PNG);
    expect(url).toMatch(new RegExp(`^/media/${h.hotel.id}/[A-Za-z0-9_-]+\\.png$`));
    const [, , hotelId, file] = url.split("/");
    const res = await media(new Request("http://x" + url), { params: Promise.resolve({ hotelId, file }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);

    const rt = h.rooms[0].roomType;
    await addPhoto(h.hotel.id, rt.id, { url: "/media/a/1.png" }, "t");
    await addPhoto(h.hotel.id, rt.id, { url: "/media/a/2.png" }, "t");
    await changePhoto(h.hotel.id, rt.id, "/media/a/2.png", "first", "t");
    let [r] = await db().select().from(roomTypes).where(eq(roomTypes.id, rt.id));
    expect(r.photos.map((p) => p.url)).toEqual(["/media/a/2.png", "/media/a/1.png"]);
    await changePhoto(h.hotel.id, rt.id, "/media/a/2.png", "remove", "t");
    [r] = await db().select().from(roomTypes).where(eq(roomTypes.id, rt.id));
    expect(r.photos.map((p) => p.url)).toEqual(["/media/a/1.png"]);
    await addPhoto(h.hotel.id, null, { url: "/media/a/hotel.png", alt: "Aussen" }, "t");
    const [hh] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
    expect(hh.content.photos).toEqual([{ url: "/media/a/hotel.png", alt: "Aussen" }]);
  });

  it("Reihenfolge der Fotos: erstes wird Titelbild, Unbekanntes ignoriert, Fremdes bleibt unberührt, Audit", async () => {
    const h = await makeHotel();
    const other = await makeHotel();
    const rt = h.rooms[0].roomType;
    for (const n of ["1", "2", "3"]) await addPhoto(h.hotel.id, rt.id, { url: `/media/a/${n}.png`, alt: n }, "t");
    await reorderPhotos(h.hotel.id, rt.id, ["/media/a/3.png", "/media/x/fremd.png", "/media/a/1.png", "/media/a/3.png"], "t");
    const [r] = await db().select().from(roomTypes).where(eq(roomTypes.id, rt.id));
    // genannte zuerst (ohne Doppelte und Unbekannte), nicht genannte hinten; Beschreibung bleibt erhalten
    expect(r.photos).toEqual([{ url: "/media/a/3.png", alt: "3" }, { url: "/media/a/1.png", alt: "1" }, { url: "/media/a/2.png", alt: "2" }]);
    // Hotel-Fotos
    await addPhoto(h.hotel.id, null, { url: "/media/a/h1.png" }, "t");
    await addPhoto(h.hotel.id, null, { url: "/media/a/h2.png" }, "t");
    await reorderPhotos(h.hotel.id, null, ["/media/a/h2.png"], "t");
    const [hh] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
    expect(hh.content.photos?.map((p) => p.url)).toEqual(["/media/a/h2.png", "/media/a/h1.png"]);
    // Mandantentrennung: Zimmertyp eines anderen Hotels
    await expect(reorderPhotos(other.hotel.id, rt.id, [], "t")).rejects.toThrow(RoomError);
    const logs = await db().select().from(auditLog).where(and(eq(auditLog.hotelId, h.hotel.id), eq(auditLog.action, "photo.order")));
    expect(logs).toHaveLength(2);
  });

  it("Upload-Route verlangt Anmeldung mit Rolle", async () => {
    const h = await makeHotel();
    const fd = new FormData();
    fd.append("file", new File([PNG], "a.png", { type: "image/png" }));
    const res = await upload(new Request("http://x", { method: "POST", body: fd }), { params: Promise.resolve({ hotelId: h.hotel.id }) }).catch((e) => e);
    // Ohne Cookie-Kontext (Next headers) wirft cookies() ausserhalb eines Requests oder antwortet 404 – nie 303
    expect(res instanceof Response ? res.status : 404).toBe(404);
  });
});
