import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookingRooms, bookings, housekeepingTasks } from "../../src/db/schema";
import { confirmBooking, createDirectBooking } from "../../src/services/bookings";
import { assignRoom, listRooms, seedRooms } from "../../src/services/frontdesk";
import { addTask, board, generateTasks, HousekeepingError, reportIssue, resolveIssue, setCleanStatus } from "../../src/services/housekeeping";
import { addDays, todayIn } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

async function setup() {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, basePriceRappen: 15000 }]);
  await seedRooms(h.hotel.id, h.rooms[0].roomType.id, "t");
  return { ...h, rs: await listRooms(h.hotel.id) };
}

/** Buchung, die heute abreist, im ersten Zimmer */
async function departingToday(s: Awaited<ReturnType<typeof setup>>) {
  const today = todayIn(s.hotel.timezone);
  const { booking } = await createDirectBooking(s.hotel, { roomTypeId: s.rooms[0].roomType.id, ratePlanId: s.rooms[0].plans[0].id, checkin: inDays(2), checkout: inDays(4), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
  await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
  // Daten auf «heute» zurückdrehen, damit der Auftrag entsteht
  await db().update(bookings).set({ checkin: addDays(today, -2), checkout: today }).where(eq(bookings.id, booking.id));
  const [br] = await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, booking.id));
  await assignRoom(s.hotel.id, br.id, s.rs[0].id, "t");
  return { today, booking };
}

describe("Housekeeping (SPEC 17.1)", () => {
  it("Abreise heute → Auftrag «checkout», Zimmer wird schmutzig; idempotent; Sauber schliesst den Auftrag", async () => {
    const s = await setup();
    const { today } = await departingToday(s);
    expect(await generateTasks(s.hotel.id, today)).toBe(1);
    expect(await generateTasks(s.hotel.id, today)).toBe(0);
    let b = await board(s.hotel.id, today);
    const r1 = b.find((x) => x.roomId === s.rs[0].id)!;
    expect(r1.status).toBe("dirty");
    expect(r1.departing).toBe(true);
    expect(r1.task?.kind).toBe("checkout");
    expect(b.find((x) => x.roomId === s.rs[1].id)!.status).toBe("clean");
    await setCleanStatus(s.hotel.id, s.rs[0].id, "clean", "t");
    b = await board(s.hotel.id, today);
    expect(b.find((x) => x.roomId === s.rs[0].id)!.task?.status).toBe("done");
    expect((await db().select().from(housekeepingTasks).where(eq(housekeepingTasks.hotelId, s.hotel.id)))[0].doneBy).toBe("t");
    // später erneut öffnen: Zimmer bleibt sauber (Auftrag existiert schon)
    await generateTasks(s.hotel.id, today);
    expect((await board(s.hotel.id, today)).find((x) => x.roomId === s.rs[0].id)!.status).toBe("clean");
  });

  it("Mängel und Extra-Aufträge; Mandantentrennung", async () => {
    const s = await setup();
    const other = await setup();
    await reportIssue(s.hotel.id, s.rs[0].id, "Glühbirne defekt", "t");
    await expect(reportIssue(s.hotel.id, s.rs[0].id, " ", "t")).rejects.toThrow(HousekeepingError);
    await expect(reportIssue(s.hotel.id, other.rs[0].id, "fremd", "t")).rejects.toThrow(HousekeepingError);
    await expect(setCleanStatus(s.hotel.id, other.rs[0].id, "dirty", "t")).rejects.toThrow(HousekeepingError);
    const today = todayIn(s.hotel.timezone);
    let b = await board(s.hotel.id, today);
    const issue = b[0].issues[0] ?? b[1].issues[0];
    expect(issue.description).toBe("Glühbirne defekt");
    await addTask(s.hotel.id, s.rs[1].id, today, "Fenster putzen", "t");
    b = await board(s.hotel.id, today);
    expect(b.find((x) => x.roomId === s.rs[1].id)!.task?.note).toBe("Fenster putzen");
    await resolveIssue(s.hotel.id, issue.id, "t");
    expect((await board(s.hotel.id, today)).every((x) => x.issues.length === 0)).toBe(true);
    await expect(resolveIssue(other.hotel.id, issue.id, "t")).rejects.toThrow(HousekeepingError);
  });
});
