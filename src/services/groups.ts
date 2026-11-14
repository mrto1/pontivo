import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, rows } from "../db/client";
import { bookings, bookingRooms, groupBlockDays, groups, guests, hotels, roomTypes, type Booking, type Group, type Hotel } from "../db/schema";
import { isDay, todayIn } from "../domain/dates";
import { createAdminBooking, type AdminBookingInput } from "./admin-bookings";
import { adjustBlock, BlockError, releaseAll } from "./group-blocks";
import { audit } from "./audit";

/** Gruppen (SPEC 18.1): Zimmerblock mit Freigabefrist, Rooming-Liste. Jede Abfrage nach hotel_id. */
export class GroupError extends Error {}

const str = (max: number) => z.string().trim().max(max).default("");
export const groupSchema = z.object({
  name: z.string().trim().min(1, "Bitte einen Namen angeben").max(120),
  company: str(120), contactName: str(120), contactEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email("E-Mail-Adresse prüfen")]).default(""),
  street: str(120), zip: str(16), city: str(60),
  arrival: z.string().refine(isDay, "Anreise ungültig"), departure: z.string().refine(isDay, "Abreise ungültig"),
  releaseOn: z.union([z.literal(""), z.string().refine(isDay, "Freigabefrist ungültig")]).default(""),
  note: str(1000),
});
export type GroupInput = z.input<typeof groupSchema>;

export async function createGroup(hotel: Hotel, input: GroupInput, actor: string): Promise<Group> {
  const v = groupSchema.parse(input);
  if (v.departure <= v.arrival) throw new GroupError("Die Abreise muss nach der Anreise liegen.");
  if (v.releaseOn && v.releaseOn > v.arrival) throw new GroupError("Die Freigabefrist muss vor der Anreise liegen.");
  const [g] = await db().insert(groups).values({ ...v, releaseOn: v.releaseOn || null, hotelId: hotel.id, createdBy: actor }).returning();
  await audit(db(), { hotelId: hotel.id, actor, action: "group.create", entity: "group", entityId: g.id, details: { name: g.name } });
  return g;
}

async function load(hotelId: string, groupId: string): Promise<Group> {
  const [g] = await db().select().from(groups).where(and(eq(groups.id, groupId), eq(groups.hotelId, hotelId)));
  if (!g) throw new GroupError("Gruppe nicht gefunden.");
  return g;
}

/** Zimmer eines Zimmertyps für die ganze Gruppenzeit zusätzlich (delta > 0) oder weniger (delta < 0) reservieren */
export async function changeBlock(hotel: Hotel, groupId: string, roomTypeId: string, delta: number, actor: string): Promise<void> {
  try {
    await db().transaction(async (tx) => {
      const [g] = rows<Group & { arrival: string; departure: string }>(await tx.execute(sql`SELECT id, status, arrival::text, departure::text FROM groups WHERE id = ${groupId} AND hotel_id = ${hotel.id} FOR UPDATE`));
      if (!g) throw new GroupError("Gruppe nicht gefunden.");
      if (g.status !== "active") throw new GroupError("Der Block dieser Gruppe ist nicht mehr aktiv.");
      const [rt] = await tx.select({ id: roomTypes.id }).from(roomTypes).where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.hotelId, hotel.id)));
      if (!rt) throw new GroupError("Zimmertyp nicht gefunden.");
      await adjustBlock(tx, hotel.id, groupId, roomTypeId, g.arrival, g.departure, delta);
      await audit(tx, { hotelId: hotel.id, actor, action: "group.block", entity: "group", entityId: groupId, details: { roomTypeId, delta } });
    });
  } catch (e) {
    if (e instanceof BlockError) throw new GroupError(e.message);
    throw e;
  }
}

/** Teilnehmer: Buchung aus dem Block (Rooming-Liste). Zeitraum innerhalb der Gruppe. */
export async function addMember(hotel: Hotel, groupId: string, input: Omit<AdminBookingInput, "ratePlanId"> & { ratePlanId: string }, actor: string): Promise<Booking> {
  const g = await load(hotel.id, groupId);
  if (g.status !== "active") throw new GroupError("Der Block dieser Gruppe ist nicht mehr aktiv.");
  if (input.checkin < g.arrival || input.checkout > g.departure) throw new GroupError("Der Aufenthalt muss innerhalb der Gruppenzeit liegen.");
  try {
    return await createAdminBooking(hotel, { ...input, notifyGuest: input.notifyGuest ?? false }, actor, new Date(), { groupId });
  } catch (e) {
    if (e instanceof BlockError) throw new GroupError(e.message);
    throw e;
  }
}

/** Block freigeben (manuell oder zur Freigabefrist): alle noch freien Blockzimmer zurück in den Verkauf */
export async function releaseGroup(hotel: Hotel, groupId: string, actor: string): Promise<number> {
  return db().transaction(async (tx) => {
    const [g] = rows<{ status: string }>(await tx.execute(sql`SELECT status FROM groups WHERE id = ${groupId} AND hotel_id = ${hotel.id} FOR UPDATE`));
    if (!g) throw new GroupError("Gruppe nicht gefunden.");
    if (g.status !== "active") return 0;
    const n = await releaseAll(tx, hotel.id, groupId);
    await tx.update(groups).set({ status: "released" }).where(eq(groups.id, groupId));
    await audit(tx, { hotelId: hotel.id, actor, action: "group.release", entity: "group", entityId: groupId, details: { rooms: n } });
    return n;
  });
}

/** Täglicher Job: Blöcke, deren Freigabefrist erreicht ist (Tag ≤ heute), automatisch freigeben */
export async function releaseDueGroups(now = new Date()): Promise<number> {
  const all = await db().select().from(hotels);
  let n = 0;
  for (const h of all) {
    const today = todayIn(h.timezone, now);
    const due = await db().select({ id: groups.id }).from(groups).where(and(eq(groups.hotelId, h.id), eq(groups.status, "active"), lte(groups.releaseOn, today)));
    for (const g of due) { await releaseGroup(h, g.id, "system"); n++; }
  }
  return n;
}

export type GroupSummary = Group & { members: number; blockLeft: number };

export async function listGroups(hotelId: string): Promise<GroupSummary[]> {
  const gs = await db().select().from(groups).where(eq(groups.hotelId, hotelId)).orderBy(desc(groups.arrival));
  const members = rows<{ group_id: string; n: number }>(await db().execute(sql`SELECT group_id, count(*)::int AS n FROM bookings WHERE hotel_id = ${hotelId} AND group_id IS NOT NULL AND status = 'confirmed' GROUP BY group_id`));
  const left = rows<{ group_id: string; n: number }>(await db().execute(sql`
    SELECT b.group_id, coalesce(sum(b.rooms),0)::int AS n FROM group_block_days b JOIN groups g ON g.id = b.group_id WHERE g.hotel_id = ${hotelId} GROUP BY b.group_id`));
  return gs.map((g) => ({ ...g, members: members.find((m) => m.group_id === g.id)?.n ?? 0, blockLeft: left.find((m) => m.group_id === g.id)?.n ?? 0 }));
}

export type RoomingRow = { bookingId: string; reference: string; guest: string; email: string; roomType: string; checkin: string; checkout: string; adults: number; children: number; totalRappen: number; notes: string };

export async function groupDetail(hotelId: string, groupId: string) {
  const g = await load(hotelId, groupId);
  const rooming = await db().select({ b: bookings, first: guests.firstName, last: guests.lastName, email: guests.email, type: roomTypes.name })
    .from(bookings).leftJoin(guests, eq(guests.id, bookings.guestId))
    .innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id)).innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
    .where(and(eq(bookings.hotelId, hotelId), eq(bookings.groupId, groupId), eq(bookings.status, "confirmed"))).orderBy(asc(guests.lastName), asc(bookings.checkin));
  const list: RoomingRow[] = rooming.map((r) => ({ bookingId: r.b.id, reference: r.b.reference, guest: [r.first, r.last].filter(Boolean).join(" "), email: r.email ?? "", roomType: r.type, checkin: r.b.checkin, checkout: r.b.checkout, adults: r.b.adults, children: r.b.children, totalRappen: r.b.totalRappen, notes: r.b.guestNotes ?? "" }));
  // Block je Zimmertyp: freie Zimmer pro Nacht (kleinster Wert = sicher vergebbar) und vergebene Teilnehmer
  const blocks = rows<{ room_type_id: string; name: string; min_left: number; max_left: number }>(await db().execute(sql`
    SELECT b.room_type_id, rt.name, min(b.rooms)::int AS min_left, max(b.rooms)::int AS max_left
      FROM group_block_days b JOIN room_types rt ON rt.id = b.room_type_id WHERE b.group_id = ${groupId} GROUP BY b.room_type_id, rt.name ORDER BY rt.name`));
  return { group: g, rooming: list, blocks: blocks.map((b) => ({ roomTypeId: b.room_type_id, name: b.name, minLeft: b.min_left, maxLeft: b.max_left })) };
}

/** Rooming-Liste als CSV (Semikolon, für Excel) */
export function roomingCsv(list: RoomingRow[]): string {
  const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  const head = ["Referenz", "Name", "E-Mail", "Zimmertyp", "Anreise", "Abreise", "Erwachsene", "Kinder", "Betrag CHF", "Bemerkung"];
  const body = list.map((r) => [r.reference, r.guest, r.email, r.roomType, r.checkin, r.checkout, r.adults, r.children, (r.totalRappen / 100).toFixed(2), r.notes].map(q).join(";"));
  return "﻿" + [head.map(q).join(";"), ...body].join("\r\n") + "\r\n";
}
