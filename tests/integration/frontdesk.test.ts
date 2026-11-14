import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookingRooms, bookings, rooms } from "../../src/db/schema";
import { confirmBooking, createDirectBooking } from "../../src/services/bookings";
import { assignRoom, autoAssign, createRoom, dayLists, deleteRoom, FrontdeskError, listRooms, planBookings, seedRooms, setRoomActive } from "../../src/services/frontdesk";
import { addDays, todayIn } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

async function setup(roomCount = 2) {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, basePriceRappen: 15000 }]);
  const rt = h.rooms[0];
  await seedRooms(h.hotel.id, rt.roomType.id, "t");
  return { ...h, rt, rooms: await listRooms(h.hotel.id) };
}
type S = Awaited<ReturnType<typeof setup>>;

async function book(s: S, from: number, nights = 2, confirm = true) {
  const checkin = inDays(from);
  const { booking } = await createDirectBooking(s.hotel, { roomTypeId: s.rt.roomType.id, ratePlanId: s.rt.plans[0].id, checkin, checkout: addDays(checkin, nights), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
  if (confirm) await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
  const [br] = await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, booking.id));
  return { booking, br };
}

describe("Rezeption (SPEC 16.2)", () => {
  it("Zimmer anlegen: passend zur Anzahl, doppelte Nummern abgelehnt, Verfügbarkeit unverändert", async () => {
    const s = await setup(3);
    expect(s.rooms.map((r) => r.number)).toEqual(["1", "2", "3"]);
    expect(await seedRooms(s.hotel.id, s.rt.roomType.id, "t")).toBe(0);
    await expect(createRoom(s.hotel.id, { roomTypeId: s.rt.roomType.id, number: "2" }, "t")).rejects.toBeInstanceOf(FrontdeskError);
  });

  it("Zuweisung: gleicher Typ, keine Doppelbelegung, überlappende Nächte blockiert, Anschluss am Abreisetag erlaubt", async () => {
    const s = await setup(2);
    const a = await book(s, 20, 3);
    const b = await book(s, 21, 2); // überlappt mit a
    const c = await book(s, 23, 2); // beginnt am Abreisetag von a
    const [r1, r2] = s.rooms;
    await assignRoom(s.hotel.id, a.br.id, r1.id, "t");
    await expect(assignRoom(s.hotel.id, b.br.id, r1.id, "t")).rejects.toThrow(/schon vergeben/);
    await assignRoom(s.hotel.id, b.br.id, r2.id, "t");
    await assignRoom(s.hotel.id, c.br.id, r1.id, "t"); // Anschluss
    // erneute Zuweisung derselben Buchung auf dasselbe Zimmer ist kein Konflikt mit sich selbst
    await assignRoom(s.hotel.id, a.br.id, r1.id, "t");
    // aufheben
    await assignRoom(s.hotel.id, c.br.id, null, "t");
    const [after] = await db().select().from(bookingRooms).where(eq(bookingRooms.id, c.br.id));
    expect(after.roomId).toBeNull();
  });

  it("anderer Hotel, anderer Typ, gesperrtes Zimmer: abgelehnt", async () => {
    const s = await setup(1);
    const other = await setup(1);
    const a = await book(s, 30);
    await expect(assignRoom(s.hotel.id, a.br.id, other.rooms[0].id, "t")).rejects.toBeInstanceOf(FrontdeskError); // fremdes Hotel
    await setRoomActive(s.hotel.id, s.rooms[0].id, false, "t");
    await expect(assignRoom(s.hotel.id, a.br.id, s.rooms[0].id, "t")).rejects.toThrow(/nicht verfügbar/);
    await expect(assignRoom(other.hotel.id, a.br.id, other.rooms[0].id, "t")).rejects.toBeInstanceOf(FrontdeskError); // Buchung gehört nicht zum Hotel
  });

  it("automatisch zuweisen: lässt Bestehendes, nimmt das freie Zimmer", async () => {
    const s = await setup(2);
    const keep = await book(s, 5, 2);
    await assignRoom(s.hotel.id, keep.br.id, s.rooms[1].id, "t");
    const x = await book(s, 5, 2);
    await expect(book(s, 5, 2)).rejects.toThrow(); // dritte gleichzeitige Buchung: Typ hat nur 2 Zimmer
    const res = await autoAssign(s.hotel.id, todayIn(s.hotel.timezone), "t");
    expect(res).toEqual({ assigned: 1, left: 0 });
    const [kept] = await db().select().from(bookingRooms).where(eq(bookingRooms.id, keep.br.id));
    expect(kept.roomId).toBe(s.rooms[1].id);
    const [xr] = await db().select().from(bookingRooms).where(eq(bookingRooms.id, x.br.id));
    expect(xr.roomId).toBe(s.rooms[0].id);
  });

  it("Plan und Tagesliste zeigen Zimmer; Zimmer mit Buchungen sind nicht löschbar", async () => {
    const s = await setup(2);
    const a = await book(s, 0, 2);
    await db().update(bookings).set({ checkin: todayIn(s.hotel.timezone) }).where(eq(bookings.id, a.booking.id));
    await assignRoom(s.hotel.id, a.br.id, s.rooms[0].id, "t");
    const plan = await planBookings(s.hotel.id, todayIn(s.hotel.timezone), 14);
    expect(plan.find((p) => p.bookingId === a.booking.id)?.roomId).toBe(s.rooms[0].id);
    const d = await dayLists(s.hotel.id, todayIn(s.hotel.timezone));
    const arr = d.arrivals.find((x) => x.bookingId === a.booking.id);
    expect(arr?.rooms).toEqual([s.rooms[0].number]);
    await expect(deleteRoom(s.hotel.id, s.rooms[0].id, "t")).rejects.toBeInstanceOf(FrontdeskError);
    await deleteRoom(s.hotel.id, s.rooms[1].id, "t");
    expect((await db().select().from(rooms).where(eq(rooms.hotelId, s.hotel.id)))).toHaveLength(1);
  });
});
