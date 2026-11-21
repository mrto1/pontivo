import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookingRooms, folioItems, hotelModules, hotels, posPayments } from "../../src/db/schema";
import { createAdminBooking } from "../../src/services/admin-bookings";
import { assignRoom, listRooms, seedRooms } from "../../src/services/frontdesk";
import { createApiKey, revokeApiKey } from "../../src/services/posbridge";
import { addLines, openOrder, pay, reverseReceipt, saveItem, webDevice } from "../../src/services/pos";
import { RoomLinkError, activeLink, connectRoomLink, remoteGuests, roomLinkTotals } from "../../src/services/room-link";
import { GET } from "../../app/api/v1/in-house/route";
import { addDays, todayIn } from "../../src/domain/dates";
import { makeHotel } from "../helpers";

afterAll(closeDb);

async function setup() {
  // Hotel A mit Gast im Zimmer, Kassen-Schnittstelle an
  const a = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
  await db().insert(hotelModules).values([{ hotelId: a.hotel.id, module: "posbridge", enabled: true }, { hotelId: a.hotel.id, module: "invoicing", enabled: true }]).onConflictDoNothing();
  await seedRooms(a.hotel.id, a.rooms[0].roomType.id, "t");
  const today = todayIn(a.hotel.timezone);
  const b = await createAdminBooking(a.hotel, { roomTypeId: a.rooms[0].roomType.id, ratePlanId: a.rooms[0].plans[0].id, checkin: today, checkout: addDays(today, 2), adults: 2, children: 0, guest: { firstName: "Max", lastName: "Muster", email: "", language: "de" }, notifyGuest: false }, "t");
  const [br] = await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, b.id));
  await assignRoom(a.hotel.id, br.id, (await listRooms(a.hotel.id))[0].id, "t");
  const { key, row } = await createApiKey(a.hotel.id, "Pächter Restaurant", "t");
  // Restaurant B (eigene Firma) mit Kasse
  const r = await makeHotel({}, []);
  await db().update(hotels).set({ propertyType: "restaurant", name: "Ristorante Ponte" }).where(eq(hotels.id, r.hotel.id));
  await db().insert(hotelModules).values([{ hotelId: r.hotel.id, module: "restaurant", enabled: true }, { hotelId: r.hotel.id, module: "pos", enabled: true }, { hotelId: r.hotel.id, module: "invoicing", enabled: true }]).onConflictDoNothing();
  const [rest] = await db().select().from(hotels).where(eq(hotels.id, r.hotel.id));
  return { a, b, key, keyRow: row, rest };
}

describe("Verpachtetes Restaurant bucht aufs Zimmer (SPEC 20.10)", () => {
  it("verbinden, Gäste des Hotels, Bon aufs Zimmer beim Hotel, Wiederholung ohne Doppel, Gegenbon, Abrechnung", async () => {
    const { a, b, key, keyRow, rest } = await setup();
    await expect(connectRoomLink(rest.id, "pnt_falsch", "t")).rejects.toBeInstanceOf(RoomLinkError);
    const { key: own } = await createApiKey(rest.id, "eigene", "t");
    await expect(connectRoomLink(rest.id, own, "t")).rejects.toThrow(/eigenen Betriebs/);
    const link = await connectRoomLink(rest.id, key, "t");
    expect(link.keyEnc).not.toContain(key);
    expect(link.label).toBe(a.hotel.name);

    // Gäste im Haus: über die API und an der Kasse des Pächters, Name nur «Nachname V.»
    const api = await GET(new Request("http://x/api/v1/in-house", { headers: { authorization: `Bearer ${key}` } }));
    expect((await api.json()).guests).toEqual([expect.objectContaining({ booking_reference: b.reference, name: "Muster M." })]);
    const guests = await remoteGuests(rest.id);
    expect(guests[0]).toMatchObject({ reference: b.reference });
    expect(guests[0].name).toContain("Muster M.");

    const item = await saveItem(rest.id, null, { category: "Essen", name: "Risotto", priceRappen: 3200, vatDineInBps: 810, vatTakeawayBps: 260 }, "t");
    const dev = await webDevice(rest.id);
    const order = await openOrder(rest.id, { deviceId: dev.id, label: "Tisch 4" }, "t");
    const [line] = await addLines(rest, order.id, [{ itemId: item.id, quantity: 2, mode: "dine_in" }], "t");
    const receiptId = crypto.randomUUID();
    const input = { receiptId, orderId: order.id, deviceId: dev.id, selection: [{ lineId: line.id, quantity: 2 }], payments: [{ method: "room" as const, amountRappen: 6400 }], tipRappen: 500, bookingReference: b.reference };
    const rec = await pay(rest, input, "t");
    const posted = await db().select().from(folioItems).where(and(eq(folioItems.hotelId, a.hotel.id), eq(folioItems.bookingId, b.id)));
    expect(posted.map((f) => f.quantity * f.unitPriceRappen).sort()).toEqual([500, 6400].sort());
    expect(posted.every((f) => f.source === `pos:${keyRow.id}`)).toBe(true);
    expect(posted.find((f) => f.unitPriceRappen === 3200)!.description).toContain("Restaurant Ristorante Ponte");
    const [p] = await db().select().from(posPayments).where(eq(posPayments.receiptId, rec.id));
    expect(p).toMatchObject({ method: "room", bookingId: null, remoteLinkId: link.id, remoteReference: b.reference });
    await pay(rest, input, "t"); // Wiederholung (Offline-Sync): nichts doppelt
    expect(await db().select().from(folioItems).where(and(eq(folioItems.hotelId, a.hotel.id), eq(folioItems.bookingId, b.id)))).toHaveLength(2);

    await reverseReceipt(rest, rec.id, dev.id, "Falscher Gast", "t");
    const after = await db().select().from(folioItems).where(and(eq(folioItems.hotelId, a.hotel.id), eq(folioItems.bookingId, b.id)));
    expect(after).toHaveLength(4);
    expect(after.reduce((s, f) => s + f.quantity * f.unitPriceRappen, 0)).toBe(0);
    const totals = await roomLinkTotals(rest.id);
    expect(totals[0]).toMatchObject({ label: a.hotel.name, count: 2, totalRappen: 0 });

    // Hotel widerruft: keine Gäste mehr, Bezahlen online abgelehnt
    await revokeApiKey(a.hotel.id, keyRow.id, "t");
    expect(await remoteGuests(rest.id)).toEqual([]);
    const o2 = await openOrder(rest.id, { deviceId: dev.id, label: "Tisch 5" }, "t");
    const [l2] = await addLines(rest, o2.id, [{ itemId: item.id, quantity: 1, mode: "dine_in" }], "t");
    await expect(pay(rest, { orderId: o2.id, deviceId: dev.id, selection: [{ lineId: l2.id, quantity: 1 }], payments: [{ method: "room", amountRappen: 3200 }], bookingReference: b.reference }, "t")).rejects.toThrow(/widerrufen/);
    expect(await activeLink(rest.id)).not.toBeNull();
  });
});
