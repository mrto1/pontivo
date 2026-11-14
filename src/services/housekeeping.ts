import { and, asc, eq, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { bookingRooms, bookings, guests, housekeepingTasks, roomIssues, rooms, roomTypes, type HousekeepingTask, type RoomIssue } from "../db/schema";
import { audit } from "./audit";

/** Housekeeping (SPEC 17.1): Reinigungsstatus je Zimmer, Tagesaufträge, Mängelmeldungen. Jede Abfrage nach hotel_id. */
export class HousekeepingError extends Error {}

export type CleanStatus = "dirty" | "clean" | "inspected";

export type BoardRoom = {
  roomId: string; number: string; floor: string; typeName: string; status: CleanStatus; active: boolean;
  /** Abreise heute, Anreise heute, im Haus (Aufenthalt läuft) */
  departing: boolean; arriving: boolean; occupied: boolean;
  guest: string | null; task: HousekeepingTask | null; issues: RoomIssue[];
};

/**
 * Legt die Aufträge für den Tag an (idempotent): Abreise heute → «checkout», dazu wird ein sauberes Zimmer «schmutzig».
 * `stayEvery` > 0: bei Gästen im Haus alle N Nächte nach Anreise eine Zwischenreinigung (ASSUMPTION: Standard aus).
 */
export async function generateTasks(hotelId: string, day: string, actor = "system", stayEvery = 0): Promise<number> {
  return db().transaction(async (tx) => {
    const base = await tx.select({ roomId: bookingRooms.roomId, bookingId: bookings.id, checkin: bookings.checkin, checkout: bookings.checkout })
      .from(bookingRooms).innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
      .where(and(eq(bookings.hotelId, hotelId), eq(bookings.status, "confirmed"), sql`${bookingRooms.roomId} IS NOT NULL`, sql`${bookings.checkin} <= ${day}`, sql`${bookings.checkout} >= ${day}`));
    let created = 0;
    for (const b of base) {
      const kind = b.checkout === day ? "checkout" : stayEvery > 0 && b.checkin < day && ((Date.parse(day) - Date.parse(b.checkin)) / 86400000) % stayEvery === 0 ? "stay" : null;
      if (!kind) continue;
      const ins = await tx.insert(housekeepingTasks).values({ hotelId, roomId: b.roomId!, bookingId: b.bookingId, kind, day }).onConflictDoNothing().returning({ id: housekeepingTasks.id });
      if (!ins.length) continue;
      created++;
      if (kind === "checkout") {
        await tx.update(rooms).set({ cleanStatus: "dirty", statusChangedAt: new Date(), statusChangedBy: actor }).where(and(eq(rooms.id, b.roomId!), eq(rooms.hotelId, hotelId), sql`${rooms.cleanStatus} <> 'dirty'`));
      }
    }
    return created;
  });
}

export async function board(hotelId: string, day: string): Promise<BoardRoom[]> {
  const rs = await db().select({ r: rooms, typeName: roomTypes.name }).from(rooms).innerJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId)).where(eq(rooms.hotelId, hotelId)).orderBy(asc(rooms.sortOrder), asc(rooms.number));
  const stays = await db().select({ roomId: bookingRooms.roomId, checkin: bookings.checkin, checkout: bookings.checkout, first: guests.firstName, last: guests.lastName, reference: bookings.reference })
    .from(bookingRooms).innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId)).leftJoin(guests, eq(guests.id, bookings.guestId))
    .where(and(eq(bookings.hotelId, hotelId), eq(bookings.status, "confirmed"), sql`${bookingRooms.roomId} IS NOT NULL`, sql`${bookings.checkin} <= ${day}`, sql`${bookings.checkout} >= ${day}`));
  const tasks = await db().select().from(housekeepingTasks).where(and(eq(housekeepingTasks.hotelId, hotelId), eq(housekeepingTasks.day, day)));
  const issues = await db().select().from(roomIssues).where(and(eq(roomIssues.hotelId, hotelId), eq(roomIssues.status, "open"))).orderBy(asc(roomIssues.createdAt));
  return rs.map(({ r, typeName }) => {
    const mine = stays.filter((s) => s.roomId === r.id);
    const inHouse = mine.find((s) => s.checkin <= day && s.checkout > day);
    const g = (inHouse ?? mine[0]);
    return {
      roomId: r.id, number: r.number, floor: r.floor, typeName, status: r.cleanStatus, active: r.active,
      departing: mine.some((s) => s.checkout === day), arriving: mine.some((s) => s.checkin === day), occupied: !!inHouse,
      guest: g ? [g.first, g.last].filter(Boolean).join(" ") || g.reference : null,
      task: tasks.find((t) => t.roomId === r.id && t.status === "open") ?? tasks.find((t) => t.roomId === r.id) ?? null,
      issues: issues.filter((i) => i.roomId === r.id),
    };
  });
}

export async function setCleanStatus(hotelId: string, roomId: string, status: CleanStatus, actor: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [r] = rows<{ id: string; clean_status: string }>(await tx.execute(sql`SELECT id, clean_status FROM rooms WHERE id = ${roomId} AND hotel_id = ${hotelId} FOR UPDATE`));
    if (!r) throw new HousekeepingError("Zimmer nicht gefunden.");
    if (r.clean_status === status) return;
    await tx.update(rooms).set({ cleanStatus: status, statusChangedAt: new Date(), statusChangedBy: actor }).where(eq(rooms.id, roomId));
    // sauber/geprüft schliesst offene Aufträge des Zimmers
    if (status !== "dirty") {
      await tx.update(housekeepingTasks).set({ status: "done", doneAt: new Date(), doneBy: actor }).where(and(eq(housekeepingTasks.roomId, roomId), eq(housekeepingTasks.hotelId, hotelId), eq(housekeepingTasks.status, "open")));
    }
    await audit(tx, { hotelId, actor, action: "housekeeping.status", entity: "room", entityId: roomId, details: { from: r.clean_status, to: status } });
  });
}

export async function addTask(hotelId: string, roomId: string, day: string, note: string, actor: string): Promise<void> {
  const [r] = await db().select({ id: rooms.id }).from(rooms).where(and(eq(rooms.id, roomId), eq(rooms.hotelId, hotelId)));
  if (!r) throw new HousekeepingError("Zimmer nicht gefunden.");
  await db().insert(housekeepingTasks).values({ hotelId, roomId, kind: "other", day, note: note.trim().slice(0, 200) }).onConflictDoUpdate({ target: [housekeepingTasks.hotelId, housekeepingTasks.roomId, housekeepingTasks.day, housekeepingTasks.kind], set: { note: note.trim().slice(0, 200), status: "open", doneAt: null, doneBy: null } });
  await audit(db(), { hotelId, actor, action: "housekeeping.task", entity: "room", entityId: roomId, details: { day } });
}

export async function reportIssue(hotelId: string, roomId: string, description: string, actor: string): Promise<void> {
  const text = description.trim().slice(0, 300);
  if (!text) throw new HousekeepingError("Bitte den Mangel kurz beschreiben.");
  const [r] = await db().select({ id: rooms.id }).from(rooms).where(and(eq(rooms.id, roomId), eq(rooms.hotelId, hotelId)));
  if (!r) throw new HousekeepingError("Zimmer nicht gefunden.");
  const [i] = await db().insert(roomIssues).values({ hotelId, roomId, description: text, reportedBy: actor }).returning();
  await audit(db(), { hotelId, actor, action: "housekeeping.issue", entity: "room", entityId: roomId, details: { issue: i.id } });
}

export async function resolveIssue(hotelId: string, issueId: string, actor: string): Promise<void> {
  const r = await db().update(roomIssues).set({ status: "done", doneAt: new Date(), doneBy: actor }).where(and(eq(roomIssues.id, issueId), eq(roomIssues.hotelId, hotelId), eq(roomIssues.status, "open"))).returning({ id: roomIssues.id });
  if (!r.length) throw new HousekeepingError("Meldung nicht gefunden.");
  await audit(db(), { hotelId, actor, action: "housekeeping.issue_done", entity: "room_issue", entityId: issueId, details: {} });
}
