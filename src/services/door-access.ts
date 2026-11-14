import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { bookingRooms, bookings, doorCodes, doorLocks, hotels, type DoorCode, type DoorLock, type Hotel } from "../db/schema";
import { decryptField, encryptField } from "../lib/guest-crypto";
import { authName, codeWindow, generateCode } from "../domain/door-codes";
import { createKeypadAuth, deleteAuth, listAuths, listSmartlocks, NukiError } from "../integrations/nuki/client";
import { todayIn, addDays } from "../domain/dates";
import { audit } from "./audit";
import { moduleOn } from "./modules";

/** Zutritt mit Nuki (SPEC 18.5): je Buchung ein Keypad-Code pro Eingangstür und für das zugewiesene Zimmer */
export class AccessError extends Error {}

const tokenOf = (hotel: Hotel): string => {
  const enc = hotel.content?.nuki?.tokenEnc;
  if (!enc) throw new AccessError("Zuerst den Nuki-Token hinterlegen.");
  return decryptField(enc)!;
};
export const nukiConfigured = (hotel: Hotel) => Boolean(hotel.content?.nuki?.tokenEnc);

export async function saveNukiToken(hotel: Hotel, token: string, actor: string): Promise<void> {
  const t = token.trim();
  if (t.length < 20) throw new AccessError("Das ist kein gültiger Nuki-Token.");
  await listSmartlocks(t).catch((e) => { throw new AccessError(e instanceof NukiError ? e.message : "Nuki nicht erreichbar."); }); // Probe, bevor gespeichert wird
  await db().update(hotels).set({ content: { ...hotel.content, nuki: { tokenEnc: encryptField(t) } }, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
  await audit(db(), { hotelId: hotel.id, actor, action: "access.token", entity: "hotel", entityId: hotel.id, details: {} });
}

export async function listLocks(hotelId: string): Promise<DoorLock[]> {
  return db().select().from(doorLocks).where(eq(doorLocks.hotelId, hotelId)).orderBy(asc(doorLocks.name));
}

/** Schlösser von Nuki laden (neue anlegen, Namen aktualisieren) */
export async function syncLocks(hotel: Hotel, actor: string): Promise<number> {
  let locks;
  try { locks = await listSmartlocks(tokenOf(hotel)); } catch (e) { if (e instanceof NukiError) throw new AccessError(e.message); throw e; }
  for (const l of locks) {
    await db().insert(doorLocks).values({ hotelId: hotel.id, nukiSmartlockId: l.smartlockId, name: l.name })
      .onConflictDoUpdate({ target: [doorLocks.hotelId, doorLocks.nukiSmartlockId], set: { name: l.name } });
  }
  await audit(db(), { hotelId: hotel.id, actor, action: "access.sync", entity: "hotel", entityId: hotel.id, details: { count: locks.length } });
  return locks.length;
}

export async function setLockRoom(hotelId: string, lockId: string, roomId: string | null, actor: string): Promise<void> {
  const r = await db().update(doorLocks).set({ roomId }).where(and(eq(doorLocks.id, lockId), eq(doorLocks.hotelId, hotelId))).returning();
  if (!r.length) throw new AccessError("Schloss nicht gefunden.");
  await audit(db(), { hotelId, actor, action: "access.lock_room", entity: "door_lock", entityId: lockId, details: { roomId } });
}

export async function codesOfBooking(hotelId: string, bookingId: string): Promise<(DoorCode & { lockName: string; code: string | null })[]> {
  const rows = await db().select({ c: doorCodes, name: doorLocks.name }).from(doorCodes).innerJoin(doorLocks, eq(doorLocks.id, doorCodes.lockId))
    .where(and(eq(doorCodes.hotelId, hotelId), eq(doorCodes.bookingId, bookingId))).orderBy(asc(doorLocks.name));
  return rows.map((r) => ({ ...r.c, lockName: r.name, code: r.c.status === "revoked" || r.c.status === "expired" ? null : decryptField(r.c.codeEnc) }));
}

/** Nuki legt asynchron an: Auth-ID über die Liste (Name + Typ Keypad) nachtragen */
async function resolveAuthId(token: string, lock: DoorLock, row: DoorCode): Promise<string | null> {
  const auths = await listAuths(token, lock.nukiSmartlockId);
  return auths.find((a) => a.name === row.authName && (a.type === 13 || a.type === 3))?.id ?? null;
}

/** Codes für eine Buchung erstellen (bestätigt, Abreise nicht vorbei). Idempotent: vorhandene Codes bleiben. */
export async function issueCodes(hotel: Hotel, bookingId: string, actor: string, now = new Date()): Promise<{ created: number; errors: number }> {
  const token = tokenOf(hotel);
  const [b] = await db().select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotel.id)));
  if (!b) throw new AccessError("Buchung nicht gefunden.");
  if (b.status !== "confirmed") throw new AccessError("Codes gibt es nur für bestätigte Buchungen.");
  const w = codeWindow(b.checkin, b.checkout, hotel.checkinTime, hotel.checkoutTime, hotel.timezone);
  if (w.until <= now) throw new AccessError("Die Abreise liegt in der Vergangenheit.");
  const roomIds = (await db().select({ r: bookingRooms.roomId }).from(bookingRooms).where(eq(bookingRooms.bookingId, bookingId))).map((x) => x.r).filter((x): x is string => !!x);
  const locks = (await listLocks(hotel.id)).filter((l) => !l.roomId || roomIds.includes(l.roomId));
  if (!locks.length) throw new AccessError("Keine Schlösser eingerichtet (Menü «Zutritt»).");
  const have = await db().select().from(doorCodes).where(eq(doorCodes.bookingId, bookingId));
  let created = 0, errors = 0;
  for (const lock of locks) {
    const ex = have.find((h) => h.lockId === lock.id);
    if (ex && ex.status !== "error" && ex.status !== "revoked") {
      if (ex.status === "pending" && !ex.nukiAuthId) { // nur Auth-ID nachtragen
        const id = await resolveAuthId(token, lock, ex).catch(() => null);
        if (id) await db().update(doorCodes).set({ nukiAuthId: id, status: "active", updatedAt: now }).where(eq(doorCodes.id, ex.id));
      }
      continue;
    }
    const code = generateCode();
    const values = { hotelId: hotel.id, bookingId, lockId: lock.id, codeEnc: encryptField(String(code)), authName: authName(b.reference), nukiAuthId: null, status: "pending" as const, error: null, validFrom: w.from, validUntil: w.until, updatedAt: now };
    const [row] = ex
      ? await db().update(doorCodes).set(values).where(eq(doorCodes.id, ex.id)).returning()
      : await db().insert(doorCodes).values(values).returning();
    try {
      await createKeypadAuth(token, lock.nukiSmartlockId, { name: row.authName, code, from: w.from, until: w.until });
      const id = await resolveAuthId(token, lock, row).catch(() => null);
      await db().update(doorCodes).set({ nukiAuthId: id, status: id ? "active" : "pending", updatedAt: now }).where(eq(doorCodes.id, row.id));
      created++;
    } catch (e) {
      errors++;
      await db().update(doorCodes).set({ status: "error", error: String((e as Error).message).slice(0, 200), updatedAt: now }).where(eq(doorCodes.id, row.id));
    }
  }
  await audit(db(), { hotelId: hotel.id, actor, action: "access.issue", entity: "booking", entityId: bookingId, details: { created, errors } });
  return { created, errors };
}

/** Codes zurückziehen (Storno, Umbuchung oder nach Abreise) */
export async function revokeCodes(hotel: Hotel, bookingId: string, actor: string, status: "revoked" | "expired" = "revoked", now = new Date()): Promise<number> {
  const token = tokenOf(hotel);
  const rows = await db().select({ c: doorCodes, l: doorLocks }).from(doorCodes).innerJoin(doorLocks, eq(doorLocks.id, doorCodes.lockId))
    .where(and(eq(doorCodes.hotelId, hotel.id), eq(doorCodes.bookingId, bookingId), inArray(doorCodes.status, ["pending", "active", "error"])));
  let n = 0;
  for (const { c, l } of rows) {
    try {
      const id = c.nukiAuthId ?? (await resolveAuthId(token, l, c).catch(() => null));
      if (id) await deleteAuth(token, l.nukiSmartlockId, id);
      await db().update(doorCodes).set({ status, updatedAt: now }).where(eq(doorCodes.id, c.id));
      n++;
    } catch (e) {
      await db().update(doorCodes).set({ error: String((e as Error).message).slice(0, 200), updatedAt: now }).where(eq(doorCodes.id, c.id)); // bleibt aktiv, Job versucht erneut
    }
  }
  if (n) await audit(db(), { hotelId: hotel.id, actor, action: "access.revoke", entity: "booking", entityId: bookingId, details: { n, status } });
  return n;
}

/**
 * Stündlicher Job (Modul «access»): Codes 3 Tage vor Anreise erstellen; bei Storno zurückziehen; nach Abreise löschen.
 * ASSUMPTION: 3 Tage Vorlauf, damit Fehler (Schloss offline) vor der Anreise auffallen.
 */
export async function accessJob(now = new Date()): Promise<{ issued: number; revoked: number }> {
  let issued = 0, revoked = 0;
  const all = await db().select().from(hotels);
  for (const hotel of all) {
    if (!nukiConfigured(hotel) || !(await moduleOn(hotel.id, "access"))) continue;
    const today = todayIn(hotel.timezone, now);
    try {
      const due = await db().select({ id: bookings.id }).from(bookings).where(and(eq(bookings.hotelId, hotel.id), eq(bookings.status, "confirmed"), sql`${bookings.checkin} <= ${addDays(today, 3)}::date`, sql`${bookings.checkout} > ${today}::date`));
      for (const b of due) { const r = await issueCodes(hotel, b.id, "job", now).catch(() => ({ created: 0, errors: 0 })); issued += r.created; }
      const stale = await db().selectDistinct({ id: doorCodes.bookingId, st: bookings.status, out: bookings.checkout }).from(doorCodes).innerJoin(bookings, eq(bookings.id, doorCodes.bookingId))
        .where(and(eq(doorCodes.hotelId, hotel.id), inArray(doorCodes.status, ["pending", "active", "error"])));
      for (const s of stale) {
        if (s.st !== "confirmed") revoked += await revokeCodes(hotel, s.id, "job", "revoked", now);
        else if (s.out < today) revoked += await revokeCodes(hotel, s.id, "job", "expired", now);
      }
    } catch (e) {
      console.error(`[access] ${hotel.slug}:`, (e as Error).message);
    }
  }
  return { issued, revoked };
}
