import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { bookingExtras, extras, roomTypes, type BookingExtra } from "../db/schema";
import { EXTRA_UNITS } from "../domain/extras";
import { audit } from "./audit";

/** Zusatzleistungen des Hotels verwalten (Admin → Zimmer → Zusatzleistungen) */

const l10n = (max: number) => z.object({ de: z.string().trim().max(max).optional(), en: z.string().trim().max(max).optional(), fr: z.string().trim().max(max).optional(), it: z.string().trim().max(max).optional(), nl: z.string().trim().max(max).optional() });

export const extraSchema = z.object({
  name: l10n(80).refine((v) => !!v.de, { message: "Name (Deutsch) fehlt" }),
  description: l10n(300).default({}),
  priceRappen: z.number().int().min(0).max(10_000_000),
  unit: z.enum(EXTRA_UNITS),
  maxQuantity: z.number().int().min(1).max(20).default(1),
  mandatory: z.boolean().default(false),
  active: z.boolean().default(true),
  roomTypeIds: z.array(z.string().uuid()).max(50).default([]),
});
export type ExtraInput = z.input<typeof extraSchema>;

export class ExtraAdminError extends Error {}

export async function listExtras(hotelId: string) {
  return db().select().from(extras).where(eq(extras.hotelId, hotelId)).orderBy(asc(extras.sortOrder), asc(extras.createdAt));
}

async function checkRoomTypes(hotelId: string, ids: string[]) {
  if (!ids.length) return;
  const own = new Set((await db().select({ id: roomTypes.id }).from(roomTypes).where(eq(roomTypes.hotelId, hotelId))).map((r) => r.id));
  if (ids.some((id) => !own.has(id))) throw new ExtraAdminError("Zimmertyp gehört nicht zu diesem Hotel");
}

export async function createExtra(hotelId: string, input: ExtraInput, actor: string) {
  const v = extraSchema.parse(input);
  await checkRoomTypes(hotelId, v.roomTypeIds);
  return db().transaction(async (tx) => {
    const n = (await tx.select({ id: extras.id }).from(extras).where(eq(extras.hotelId, hotelId))).length;
    if (n >= 30) throw new ExtraAdminError("Höchstens 30 Zusatzleistungen pro Hotel");
    const [e] = await tx.insert(extras).values({ hotelId, ...v, sortOrder: n }).returning();
    await audit(tx, { hotelId, actor, action: "extra.create", entity: "extra", entityId: e.id, details: { name: v.name.de, price: v.priceRappen, unit: v.unit, mandatory: v.mandatory } });
    return e;
  });
}

export async function updateExtra(hotelId: string, id: string, input: ExtraInput, actor: string) {
  const v = extraSchema.parse(input);
  await checkRoomTypes(hotelId, v.roomTypeIds);
  await db().transaction(async (tx) => {
    const r = await tx.update(extras).set(v).where(and(eq(extras.id, id), eq(extras.hotelId, hotelId))).returning({ id: extras.id });
    if (!r.length) throw new ExtraAdminError("Zusatzleistung nicht gefunden");
    await audit(tx, { hotelId, actor, action: "extra.update", entity: "extra", entityId: id, details: { price: v.priceRappen, unit: v.unit, mandatory: v.mandatory, active: v.active } });
  });
}

/** Löschen: bestehende Buchungen behalten Name und Preis (booking_extras ist eingefroren) */
export async function deleteExtra(hotelId: string, id: string, actor: string) {
  await db().transaction(async (tx) => {
    const r = await tx.delete(extras).where(and(eq(extras.id, id), eq(extras.hotelId, hotelId))).returning({ id: extras.id });
    if (r.length) await audit(tx, { hotelId, actor, action: "extra.delete", entity: "extra", entityId: id });
  });
}

export async function moveExtra(hotelId: string, id: string, dir: -1 | 1, actor: string) {
  const list = await listExtras(hotelId);
  const i = list.findIndex((e) => e.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await db().transaction(async (tx) => {
    for (const [k, e] of list.entries()) await tx.update(extras).set({ sortOrder: k }).where(and(eq(extras.id, e.id), eq(extras.hotelId, hotelId)));
    await audit(tx, { hotelId, actor, action: "extra.move", entity: "extra", entityId: id });
  });
}

export async function bookingExtrasOf(bookingId: string): Promise<BookingExtra[]> {
  return db().select().from(bookingExtras).where(eq(bookingExtras.bookingId, bookingId)).orderBy(asc(bookingExtras.position));
}
