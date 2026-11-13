import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { channexOutbox, hotels, icalFeedNights, inventoryDays, roomTypes } from "../../src/db/schema";
import { addFeed, exportFeed, regenerateToken, removeFeed, syncFeed } from "../../src/services/ical";
import { searchOffers } from "../../src/services/search";
import { setBlocked } from "../../src/services/inventory";
import { addDays } from "../../src/domain/dates";
import { inDays, makeHotel } from "../helpers";

afterAll(closeDb);

const ev = (a: string, b: string) => `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${a.replace(/-/g, "")}\r\nDTEND;VALUE=DATE:${b.replace(/-/g, "")}\r\nEND:VEVENT\r\n`;
const ics = (...e: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${e.join("")}END:VCALENDAR\r\n`;
const inv = async (rt: string, night: string) => (await db().select().from(inventoryDays).where(eq(inventoryDays.roomTypeId, rt)).then((r) => r.find((x) => x.night === night)))!;

async function setup() {
  const h = await makeHotel();
  const rt = h.rooms[0].roomType;
  await db().update(roomTypes).set({ roomCount: 1 }).where(eq(roomTypes.id, rt.id));
  await db().update(inventoryDays).set({ total: 1 }).where(eq(inventoryDays.roomTypeId, rt.id));
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  return { h, hotel, rt };
}

describe("iCal-Import", () => {
  it("belegt Nächte, verhindert Buchung, meldet an Channex, gibt wieder frei; Fehler lassen alles stehen", async () => {
    const { h, hotel, rt } = await setup();
    const d = inDays(40);
    const feed = await addFeed(h.hotel.id, rt.id, { name: "Airbnb", url: "https://example.com/a.ics?s=geheim" }, "t");
    const before = (await db().select().from(channexOutbox).where(eq(channexOutbox.hotelId, h.hotel.id))).length;

    let r = await syncFeed(feed.id, { fetchText: async () => ics(ev(d, addDays(d, 3))) });
    expect(r).toMatchObject({ ok: true, added: 3, removed: 0 });
    expect((await inv(rt.id, d)).externalBlocked).toBe(1);
    expect((await inv(rt.id, addDays(d, 3))).externalBlocked).toBe(0);
    expect((await db().select().from(channexOutbox).where(eq(channexOutbox.hotelId, h.hotel.id))).length).toBeGreaterThan(before);

    // Suche: Nächte nicht mehr buchbar, Nachbarnächte schon
    const q = (x: string, y: string) => searchOffers(hotel, { checkin: x, checkout: y, adults: 2, children: 0 }, { roomTypeId: rt.id });
    const blocked = await q(d, addDays(d, 2));
    expect(blocked.ok && blocked.offers.length).toBe(0);
    const free = await q(addDays(d, 3), addDays(d, 5));
    expect(free.ok && free.offers.length).toBeGreaterThan(0);

    // Abruf schlägt fehl → Stand bleibt, Fehler gespeichert
    r = await syncFeed(feed.id, { fetchText: async () => { throw new Error("Zeitüberschreitung"); } });
    expect(r.ok).toBe(false);
    expect((await inv(rt.id, d)).externalBlocked).toBe(1);
    // HTML statt Kalender → ebenfalls nichts freigeben
    r = await syncFeed(feed.id, { fetchText: async () => "<html>Login</html>" });
    expect(r.ok).toBe(false);
    expect((await inv(rt.id, d)).externalBlocked).toBe(1);

    // verkürzt → eine Nacht frei, eine neue belegt
    r = await syncFeed(feed.id, { fetchText: async () => ics(ev(d, addDays(d, 2)), ev(addDays(d, 10), addDays(d, 11))) });
    expect(r).toMatchObject({ ok: true, added: 1, removed: 1 });
    expect((await inv(rt.id, addDays(d, 2))).externalBlocked).toBe(0);

    await removeFeed(h.hotel.id, feed.id, "t");
    expect((await inv(rt.id, d)).externalBlocked).toBe(0);
    expect(await db().select().from(icalFeedNights).where(eq(icalFeedNights.feedId, feed.id))).toHaveLength(0);
  });

  it("zwei Kalender, dieselbe Nacht: höchstens total, erst frei wenn beide frei; Doppelbelegung wird gezählt", async () => {
    const { h, rt } = await setup();
    const d = inDays(60);
    const a = await addFeed(h.hotel.id, rt.id, { name: "A", url: "https://example.com/a.ics" }, "t");
    const b = await addFeed(h.hotel.id, rt.id, { name: "B", url: "https://example.org/b.ics" }, "t");
    await syncFeed(a.id, { fetchText: async () => ics(ev(d, addDays(d, 1))) });
    await syncFeed(b.id, { fetchText: async () => ics(ev(d, addDays(d, 1))) });
    expect((await inv(rt.id, d)).externalBlocked).toBe(1); // nicht 2
    await syncFeed(a.id, { fetchText: async () => ics() });
    expect((await inv(rt.id, d)).externalBlocked).toBe(1); // B hält noch
    await syncFeed(b.id, { fetchText: async () => ics() });
    expect((await inv(rt.id, d)).externalBlocked).toBe(0);

    // eigene Buchung vorhanden, dann belegt Airbnb dieselbe Nacht → Konflikt
    const e = addDays(d, 5);
    await db().update(inventoryDays).set({ booked: 1 }).where(eq(inventoryDays.roomTypeId, rt.id));
    const r = await syncFeed(a.id, { fetchText: async () => ics(ev(e, addDays(e, 1))) });
    expect(r.conflicts).toBe(1);
  });

  it("Grenzen: Mandant, Adresse, Anzahl", async () => {
    const { h, rt } = await setup();
    const other = await makeHotel();
    await expect(addFeed(other.hotel.id, rt.id, { name: "x", url: "https://example.com/a.ics" }, "t")).rejects.toThrow(/nicht gefunden/);
    await expect(addFeed(h.hotel.id, rt.id, { name: "x", url: "http://example.com/a.ics" }, "t")).rejects.toThrow(/https/);
    await expect(addFeed(h.hotel.id, rt.id, { name: "x", url: "https://169.254.169.254/x" }, "t")).rejects.toThrow(/Interne/);
    for (let i = 0; i < 5; i++) await addFeed(h.hotel.id, rt.id, { name: `f${i}`, url: `https://example.com/${i}.ics` }, "t");
    await expect(addFeed(h.hotel.id, rt.id, { name: "6", url: "https://example.com/6.ics" }, "t")).rejects.toThrow(/Höchstens/);
    const feeds = await db().query.icalFeeds.findMany({ where: (f, { eq }) => eq(f.hotelId, h.hotel.id) });
    await expect(removeFeed(other.hotel.id, feeds[0].id, "t")).rejects.toThrow(/nicht gefunden/);
  });
});

describe("iCal-Export", () => {
  it("nur eigene ausverkaufte Nächte, keine Importe, kein Gästename; Token erneuern macht alten ungültig", async () => {
    const { h, rt } = await setup();
    const d = inDays(80);
    await setBlocked(h.hotel.id, rt.id, d, addDays(d, 1), 1, { actor: "t" });
    const feed = await addFeed(h.hotel.id, rt.id, { name: "A", url: "https://example.com/a.ics" }, "t");
    await syncFeed(feed.id, { fetchText: async () => ics(ev(addDays(d, 10), addDays(d, 12))) });
    const [row] = await db().select().from(roomTypes).where(eq(roomTypes.id, rt.id));
    const text = (await exportFeed(row.icalToken))!;
    expect(text).toContain(`DTSTART;VALUE=DATE:${d.replace(/-/g, "")}`);
    expect(text).toContain("DTEND;VALUE=DATE:" + addDays(d, 2).replace(/-/g, ""));
    expect(text).not.toContain(addDays(d, 10).replace(/-/g, "")); // Import wird nicht zurückgespiegelt
    expect(text).not.toMatch(/ATTENDEE|DESCRIPTION|Muster|@example/);

    expect(await exportFeed("x".repeat(64))).toBeNull();
    expect(await exportFeed("kurz")).toBeNull();
    await regenerateToken(h.hotel.id, rt.id, "t");
    expect(await exportFeed(row.icalToken)).toBeNull();
    await expect(regenerateToken((await makeHotel()).hotel.id, rt.id, "t")).rejects.toThrow();
  });
});
