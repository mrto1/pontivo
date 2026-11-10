import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, rows } from "../db/client";
import { hotels, ratePlans, ratesDays, roomTypes } from "../db/schema";
import { addDays, nightsOf, todayIn } from "../domain/dates";
import { audit } from "./audit";
import { enqueueAvailability, enqueueRestrictions } from "./outbox";
import { ensureInventory, HORIZON_DAYS } from "./inventory";

/**
 * Zimmertypen und Ratepläne verwalten (SPEC 9 Einstellungen).
 * Jede Änderung, die Verfügbarkeit oder Preise betrifft: Transaktion + Outbox + audit_log.
 */

export class RoomError extends Error {}

export const roomTypeSchema = z
  .object({
    name: z.string().trim().min(1, "Name fehlt").max(120),
    description: z.string().trim().max(2000).nullable(),
    roomCount: z.number().int().min(0).max(500),
    maxAdults: z.number().int().min(1).max(20),
    maxChildren: z.number().int().min(0).max(20),
    maxOccupancy: z.number().int().min(1).max(30),
    sortOrder: z.number().int().min(0).max(999),
    active: z.boolean(),
    i18n: z.object(Object.fromEntries(["en", "fr", "it", "nl"].map((l) => [l, z.object({ name: z.string().trim().max(120).optional(), description: z.string().trim().max(2000).optional() }).optional()])) as Record<"en" | "fr" | "it" | "nl", z.ZodOptional<z.ZodObject<{ name: z.ZodOptional<z.ZodString>; description: z.ZodOptional<z.ZodString> }>>>).default({}),
  })
  .refine((v) => v.maxOccupancy >= v.maxAdults, { message: "Max. Personen muss mindestens so gross sein wie max. Erwachsene", path: ["maxOccupancy"] });
export type RoomTypeInput = z.input<typeof roomTypeSchema>;

export const ratePlanSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(120),
  breakfastIncluded: z.boolean(),
  freeCancelHours: z.number().int().min(0).max(24 * 365).nullable(), // null = nicht kostenlos stornierbar
  cancelFeeBps: z.number().int().min(0).max(10000),
  baseOccupancy: z.number().int().min(1).max(30),
  extraAdultRappen: z.number().int().min(0).max(10_000_000),
  singleDiscountRappen: z.number().int().min(0).max(10_000_000),
  minNights: z.number().int().min(1, "Mindestens 1 Nacht").max(60).default(1),
  arrivalWeekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]).transform((a) => [...new Set(a)].sort()),
  active: z.boolean(),
  i18n: z.object(Object.fromEntries(["en", "fr", "it", "nl"].map((l) => [l, z.object({ name: z.string().trim().max(120).optional() }).optional()])) as Record<"en" | "fr" | "it" | "nl", z.ZodOptional<z.ZodObject<{ name: z.ZodOptional<z.ZodString> }>>>).default({}),
});
export type RatePlanInput = z.input<typeof ratePlanSchema>;

async function hotelOrThrow(hotelId: string) {
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotelId));
  if (!h) throw new RoomError("Hotel nicht gefunden");
  return h;
}

export async function listRooms(hotelId: string) {
  const rts = await db().select().from(roomTypes).where(eq(roomTypes.hotelId, hotelId)).orderBy(asc(roomTypes.sortOrder), asc(roomTypes.name));
  const rps = await db().select().from(ratePlans).where(eq(ratePlans.hotelId, hotelId)).orderBy(asc(ratePlans.createdAt));
  return rts.map((rt) => ({ roomType: rt, plans: rps.filter((p) => p.roomTypeId === rt.id) }));
}

/** Neuer Zimmertyp + Verfügbarkeit für 18 Monate (total = Anzahl Zimmer) */
export async function createRoomType(hotelId: string, input: RoomTypeInput, actor: string) {
  const v = roomTypeSchema.parse(input);
  const hotel = await hotelOrThrow(hotelId);
  const today = todayIn(hotel.timezone);
  const end = addDays(today, HORIZON_DAYS);
  return db().transaction(async (tx) => {
    const [rt] = await tx.insert(roomTypes).values({ ...v, hotelId }).returning();
    await ensureInventory(tx, hotelId, rt.id, today, end);
    await enqueueAvailability(tx, hotelId, rt.id, today, addDays(end, -1));
    await audit(tx, { hotelId, actor, action: "room_type.create", entity: "room_type", entityId: rt.id, details: v });
    return rt;
  });
}

/**
 * Zimmertyp ändern. Ändert sich die Anzahl Zimmer, wird `total` ab heute nachgeführt.
 * Weniger Zimmer als schon gebucht/gesperrt → Fehler mit dem ersten betroffenen Datum.
 */
export async function updateRoomType(hotelId: string, roomTypeId: string, input: RoomTypeInput, actor: string) {
  const v = roomTypeSchema.parse(input);
  const hotel = await hotelOrThrow(hotelId);
  const today = todayIn(hotel.timezone);
  return db().transaction(async (tx) => {
    const [old] = rows<{ room_count: number }>(
      await tx.execute(sql`SELECT room_count FROM room_types WHERE id = ${roomTypeId} AND hotel_id = ${hotelId} FOR UPDATE`),
    );
    if (!old) throw new RoomError("Zimmertyp nicht gefunden");
    const [prev] = await tx.select({ active: roomTypes.active }).from(roomTypes).where(eq(roomTypes.id, roomTypeId));
    // Inaktiv = bei Channex Verfügbarkeit 0 → neu senden, wenn sich aktiv/inaktiv ändert
    if (prev.active !== v.active) await enqueueAvailability(tx, hotelId, roomTypeId, today, addDays(today, HORIZON_DAYS - 1));
    if (v.roomCount !== old.room_count) {
      const [conflict] = rows<{ night: string; used: number }>(
        await tx.execute(sql`
          SELECT night::text, booked + blocked AS used FROM inventory_days
           WHERE room_type_id = ${roomTypeId} AND night >= ${today}::date AND booked + blocked > ${v.roomCount}
           ORDER BY night LIMIT 1`),
      );
      if (conflict) {
        throw new RoomError(`Am ${conflict.night} sind schon ${conflict.used} Zimmer gebucht oder gesperrt – weniger als ${conflict.used} geht nicht.`);
      }
      const updated = await tx.execute(sql`
        UPDATE inventory_days SET total = ${v.roomCount}, updated_at = now()
         WHERE room_type_id = ${roomTypeId} AND night >= ${today}::date
        RETURNING night`);
      if (updated.rows.length) await enqueueAvailability(tx, hotelId, roomTypeId, today, addDays(today, HORIZON_DAYS - 1));
    }
    const [rt] = await tx.update(roomTypes).set(v).where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.hotelId, hotelId))).returning();
    await audit(tx, { hotelId, actor, action: "room_type.update", entity: "room_type", entityId: roomTypeId, details: { ...v, previousRoomCount: old.room_count } });
    return rt;
  });
}

/** Neuer Rateplan mit Startpreis für den ganzen Horizont (Mindestnächte 1, offen) */
export async function createRatePlan(hotelId: string, roomTypeId: string, input: RatePlanInput, priceRappen: number, actor: string) {
  const v = ratePlanSchema.parse(input);
  if (!Number.isSafeInteger(priceRappen) || priceRappen <= 0) throw new RoomError("Startpreis muss grösser als 0 sein");
  const hotel = await hotelOrThrow(hotelId);
  const today = todayIn(hotel.timezone);
  const end = addDays(today, HORIZON_DAYS);
  return db().transaction(async (tx) => {
    const [rt] = await tx.select().from(roomTypes).where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.hotelId, hotelId)));
    if (!rt) throw new RoomError("Zimmertyp nicht gefunden");
    const [rp] = await tx.insert(ratePlans).values({ ...v, hotelId, roomTypeId }).returning();
    const values = nightsOf(today, end).map((night) => ({ hotelId, ratePlanId: rp.id, night, priceRappen }));
    for (let k = 0; k < values.length; k += 500) await tx.insert(ratesDays).values(values.slice(k, k + 500));
    await enqueueRestrictions(tx, hotelId, rp.id, today, addDays(end, -1));
    await audit(tx, { hotelId, actor, action: "rate_plan.create", entity: "rate_plan", entityId: rp.id, details: { ...v, priceRappen } });
    return rp;
  });
}

/** Rateplan ändern (Name, Frühstück, Stornoregel, Belegung). Preise pro Tag bleiben im Kalender. */
export async function updateRatePlan(hotelId: string, ratePlanId: string, input: RatePlanInput, actor: string) {
  const v = ratePlanSchema.parse(input);
  const hotel = await hotelOrThrow(hotelId);
  const today = todayIn(hotel.timezone);
  return db().transaction(async (tx) => {
    const [old] = await tx.select().from(ratePlans).where(and(eq(ratePlans.id, ratePlanId), eq(ratePlans.hotelId, hotelId)));
    if (!old) throw new RoomError("Tarif nicht gefunden");
    const [rp] = await tx.update(ratePlans).set(v).where(eq(ratePlans.id, ratePlanId)).returning();
    // aktiv/inaktiv wirkt bei Channex als Verkaufsstopp; Belegung/Zuschläge ändern die Preise je Belegung → neu senden
    const pricingChanged =
      old.baseOccupancy !== rp.baseOccupancy || old.extraAdultRappen !== rp.extraAdultRappen || old.singleDiscountRappen !== rp.singleDiscountRappen || old.minNights !== rp.minNights || old.arrivalWeekdays.join() !== rp.arrivalWeekdays.join();
    if (old.active !== v.active || pricingChanged) await enqueueRestrictions(tx, hotelId, ratePlanId, today, addDays(today, HORIZON_DAYS - 1));
    await audit(tx, { hotelId, actor, action: "rate_plan.update", entity: "rate_plan", entityId: ratePlanId, details: v });
    return rp;
  });
}

// ---------------------------------------------------------------- Fotos

export type Photo = { url: string; alt?: string };
export const MAX_PHOTOS = 12;

/** Foto an Hotel (roomTypeId = null) oder Zimmertyp anhängen */
export async function addPhoto(hotelId: string, roomTypeId: string | null, photo: Photo, actor: string) {
  return db().transaction(async (tx) => {
    if (roomTypeId) {
      const [rt] = await tx.select().from(roomTypes).where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.hotelId, hotelId)));
      if (!rt) throw new RoomError("Zimmertyp nicht gefunden");
      if (rt.photos.length >= MAX_PHOTOS) throw new RoomError(`Höchstens ${MAX_PHOTOS} Fotos pro Zimmertyp`);
      await tx.update(roomTypes).set({ photos: [...rt.photos, photo] }).where(eq(roomTypes.id, roomTypeId));
    } else {
      const [h] = await tx.select().from(hotels).where(eq(hotels.id, hotelId));
      if (!h) throw new RoomError("Hotel nicht gefunden");
      const photos = h.content.photos ?? [];
      if (photos.length >= MAX_PHOTOS) throw new RoomError(`Höchstens ${MAX_PHOTOS} Fotos für das Hotel`);
      await tx.update(hotels).set({ content: { ...h.content, photos: [...photos, photo] } }).where(eq(hotels.id, hotelId));
    }
    await audit(tx, { hotelId, actor, action: "photo.add", entity: roomTypeId ? "room_type" : "hotel", entityId: roomTypeId ?? hotelId, details: { url: photo.url } });
  });
}

/** Foto entfernen oder nach vorne holen (Titelbild = erstes Foto) */
export async function changePhoto(hotelId: string, roomTypeId: string | null, url: string, action: "remove" | "first", actor: string) {
  const apply = (list: Photo[]) => {
    const p = list.find((x) => x.url === url);
    if (!p) throw new RoomError("Foto nicht gefunden");
    const rest = list.filter((x) => x.url !== url);
    return action === "remove" ? rest : [p, ...rest];
  };
  await db().transaction(async (tx) => {
    if (roomTypeId) {
      const [rt] = await tx.select().from(roomTypes).where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.hotelId, hotelId)));
      if (!rt) throw new RoomError("Zimmertyp nicht gefunden");
      await tx.update(roomTypes).set({ photos: apply(rt.photos) }).where(eq(roomTypes.id, roomTypeId));
    } else {
      const [h] = await tx.select().from(hotels).where(eq(hotels.id, hotelId));
      await tx.update(hotels).set({ content: { ...h.content, photos: apply(h.content.photos ?? []) } }).where(eq(hotels.id, hotelId));
    }
    await audit(tx, { hotelId, actor, action: `photo.${action}`, entity: roomTypeId ? "room_type" : "hotel", entityId: roomTypeId ?? hotelId, details: { url } });
  });
}
