import { randomBytes } from "node:crypto";
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "../db/client";
import { posReservations, posTables, restaurantSettings, type Hotel, type PosReservation } from "../db/schema";
import { addDays, diffDays, isDay, todayIn } from "../domain/dates";
import { TIME_RE, checkWindows, coversAt, onlineSlots, tableFree, type ResSettings, type Slot } from "../domain/reservations";
import { enqueueEmail } from "../email/enqueue";
import { audit } from "./audit";
import { PosError } from "./pos";

/** Tischreservierungen, intern und online (SPEC 19.49 Etappe C). Jede Abfrage nach hotel_id. */
const clean = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);

export const DEFAULT_SETTINGS: ResSettings = { onlineEnabled: false, windows: [{ from: "11:30", to: "13:30" }, { from: "18:00", to: "21:00" }], durationMin: 90, maxParty: 8, capacity: 40, leadHours: 2, horizonDays: 60 };

export async function getSettings(hotelId: string): Promise<ResSettings> {
  const [r] = await db().select().from(restaurantSettings).where(eq(restaurantSettings.hotelId, hotelId));
  return r ? { onlineEnabled: r.onlineEnabled, windows: r.windows, durationMin: r.durationMin, maxParty: r.maxParty, capacity: r.capacity, leadHours: r.leadHours, horizonDays: r.horizonDays } : DEFAULT_SETTINGS;
}

export async function saveSettings(hotelId: string, s: ResSettings, actor: string) {
  const bad = checkWindows(s.windows);
  if (bad) throw new PosError(bad);
  const ranges: [number, number, number, string][] = [[s.durationMin, 30, 480, "Dauer"], [s.maxParty, 1, 50, "Grösste Gruppe"], [s.capacity, 1, 1000, "Plätze"], [s.leadHours, 0, 168, "Vorlauf"], [s.horizonDays, 1, 365, "Vorschau"]];
  for (const [v, lo, hi, n] of ranges) if (!Number.isInteger(v) || v < lo || v > hi) throw new PosError(`${n}: ${lo} bis ${hi}.`);
  await db().transaction(async (tx) => {
    await tx.insert(restaurantSettings).values({ hotelId, ...s }).onConflictDoUpdate({ target: restaurantSettings.hotelId, set: { ...s, updatedAt: new Date() } });
    await audit(tx, { hotelId, actor, action: "restaurant.settings", entity: "restaurant_settings", entityId: hotelId });
  });
}

export const reservationsOfDay = (hotelId: string, day: string) =>
  db().select().from(posReservations).where(and(eq(posReservations.hotelId, hotelId), eq(posReservations.day, day))).orderBy(asc(posReservations.time), asc(posReservations.createdAt));

/** Reservierungen im Zeitraum (für «Heute» im Tischplan: Beginn bis Ende des Tages) */
export const reservationsBetween = (hotelId: string, from: string, to: string) =>
  db().select().from(posReservations).where(and(eq(posReservations.hotelId, hotelId), gte(posReservations.day, from), lte(posReservations.day, to))).orderBy(asc(posReservations.day), asc(posReservations.time));

function nowIn(hotel: Hotel) {
  const d = new Date();
  return { day: todayIn(hotel.timezone, d), minutes: Number(formatInTimeZone(d, hotel.timezone, "H")) * 60 + Number(formatInTimeZone(d, hotel.timezone, "m")) };
}

/** Freie Zeiten für Gäste an einem Tag */
export async function slotsFor(hotel: Hotel, day: string, party: number): Promise<Slot[]> {
  if (!isDay(day)) return [];
  const [s, ex] = await Promise.all([getSettings(hotel.id), reservationsOfDay(hotel.id, day)]);
  const now = nowIn(hotel);
  return onlineSlots(s, day, party, ex, now, diffDays(now.day, day));
}

export type ReservationInput = { day: string; time: string; party: number; name: string; phone?: string; email?: string; note?: string; tableId?: string | null; language?: string };

/** Reservierung anlegen. `online`: Zeitfenster, Vorlauf, Kapazität und Gruppengrösse gelten; intern darf der Betrieb überbuchen. Mit E-Mail geht eine Bestätigung raus. */
export async function createReservation(hotel: Hotel, i: ReservationInput, source: "admin" | "online", actor: string): Promise<PosReservation> {
  const name = clean(i.name, 80);
  if (!name) throw new PosError("Der Name fehlt.");
  if (!isDay(i.day)) throw new PosError("Datum ungültig.");
  if (!TIME_RE.test(i.time)) throw new PosError("Uhrzeit ungültig.");
  if (!Number.isInteger(i.party) || i.party < 1 || i.party > 50) throw new PosError("Personen: 1 bis 50.");
  const email = clean(i.email ?? "", 200).toLowerCase();
  const phone = clean(i.phone ?? "", 40);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new PosError("E-Mail-Adresse ungültig.");
  if (source === "online" && !email && !phone) throw new PosError("Bitte E-Mail oder Telefon angeben.");
  const s = await getSettings(hotel.id);
  const token = randomBytes(18).toString("base64url");
  return db().transaction(async (tx) => {
    const existing = await tx.select().from(posReservations).where(and(eq(posReservations.hotelId, hotel.id), eq(posReservations.day, i.day)));
    if (source === "online") {
      const now = nowIn(hotel);
      const slot = onlineSlots(s, i.day, i.party, existing, now, diffDays(now.day, i.day)).find((x) => x.time === i.time);
      if (!s.onlineEnabled) throw new PosError("Online-Reservierung ist nicht aktiv.");
      if (i.party > s.maxParty) throw new PosError(`Für Gruppen ab ${s.maxParty + 1} Personen bitte anrufen.`);
      if (!slot || !slot.ok) throw new PosError("Diese Zeit ist leider nicht mehr frei. Bitte eine andere wählen.");
    }
    let tableId: string | null = null;
    if (i.tableId) {
      const [t] = await tx.select().from(posTables).where(and(eq(posTables.id, i.tableId), eq(posTables.hotelId, hotel.id)));
      if (!t) throw new PosError("Tisch nicht gefunden.");
      if (!tableFree(existing, t.id, i.time, s.durationMin)) throw new PosError(`${t.name} ist zu dieser Zeit schon reserviert.`);
      tableId = t.id;
    }
    const [r] = await tx.insert(posReservations).values({ hotelId: hotel.id, day: i.day, time: i.time, party: i.party, name, phone, email, note: clean(i.note ?? "", 300), tableId, source, language: i.language ?? hotel.defaultLanguage, publicToken: token }).returning();
    await audit(tx, { hotelId: hotel.id, actor, action: "reservation.create", entity: "pos_reservation", entityId: r.id, details: { source, day: r.day, time: r.time, party: r.party } });
    if (email) await enqueueEmail(tx, { hotelId: hotel.id, template: "table_reserved", to: email, language: r.language, data: { name, day: r.day, time: r.time, party: r.party, token, reservationId: r.id } });
    return r;
  });
}

export async function reservationByToken(token: string): Promise<PosReservation | null> {
  const [r] = await db().select().from(posReservations).where(eq(posReservations.publicToken, token));
  return r ?? null;
}

/** Gast storniert über seinen Link (nur solange bestätigt) */
export async function cancelByToken(token: string): Promise<PosReservation> {
  const [r] = await db().update(posReservations).set({ status: "cancelled" }).where(and(eq(posReservations.publicToken, token), eq(posReservations.status, "confirmed"))).returning();
  if (!r) throw new PosError("Diese Reservierung kann nicht mehr storniert werden.");
  await audit(db(), { hotelId: r.hotelId, actor: "guest", action: "reservation.cancel", entity: "pos_reservation", entityId: r.id });
  return r;
}

export async function setReservationStatus(hotelId: string, id: string, status: "confirmed" | "seated" | "cancelled" | "noshow", actor: string) {
  const [r] = await db().update(posReservations).set({ status }).where(and(eq(posReservations.id, id), eq(posReservations.hotelId, hotelId))).returning();
  if (!r) throw new PosError("Reservierung nicht gefunden.");
  await audit(db(), { hotelId, actor, action: "reservation.status", entity: "pos_reservation", entityId: id, details: { status } });
}

/** Tisch zuweisen oder lösen (null); der Tisch muss zur Zeit frei sein */
export async function assignTable(hotelId: string, id: string, tableId: string | null, actor: string) {
  const [r] = await db().select().from(posReservations).where(and(eq(posReservations.id, id), eq(posReservations.hotelId, hotelId)));
  if (!r) throw new PosError("Reservierung nicht gefunden.");
  if (tableId) {
    const [t] = await db().select().from(posTables).where(and(eq(posTables.id, tableId), eq(posTables.hotelId, hotelId)));
    if (!t) throw new PosError("Tisch nicht gefunden.");
    const s = await getSettings(hotelId);
    const others = await db().select().from(posReservations).where(and(eq(posReservations.hotelId, hotelId), eq(posReservations.day, r.day), ne(posReservations.id, id)));
    if (!tableFree(others, t.id, r.time, s.durationMin)) throw new PosError(`${t.name} ist zu dieser Zeit schon reserviert.`);
  }
  await db().update(posReservations).set({ tableId }).where(eq(posReservations.id, id));
  await audit(db(), { hotelId, actor, action: "reservation.table", entity: "pos_reservation", entityId: id, details: { tableId } });
}

/** Plätze, die zu einer Zeit noch frei sind (Anzeige intern) */
export async function freeSeats(hotelId: string, day: string, time: string) {
  const [s, ex] = await Promise.all([getSettings(hotelId), reservationsOfDay(hotelId, day)]);
  return s.capacity - coversAt(ex, time, s.durationMin);
}

export { addDays };
