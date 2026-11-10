import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, rows } from "../db/client";
import {
  bookingRooms, bookings, cantonRules, guestRegistrations, guests, hotelModules, hotels, roomTypes,
  type GuestRegistration, type Hotel,
} from "../db/schema";
import { addDays, ageOn, diffDays, isDay, todayIn, zonedToUtc } from "../domain/dates";
import { isCountry } from "../domain/countries";
import { ratePerPerson } from "../domain/tourist-tax";
import { decryptField, encryptField, encryptOpt } from "../lib/guest-crypto";
import { enqueueEmail } from "../email/enqueue";
import { audit } from "./audit";
import { taxRuleFor } from "./hotels";
import { registrationReporter } from "../integrations/registration/reporter";

/**
 * Modul «Gäste» (SPEC 14): Online-Check-in mit Meldeschein, Tagesliste, Register-Export, Kurtaxe-Liste, Löschjob.
 */

// ---------------------------------------------------------------- Modul und Kantonsregel

export async function guestsModuleEnabled(hotelId: string): Promise<boolean> {
  const [m] = await db().select().from(hotelModules).where(and(eq(hotelModules.hotelId, hotelId), eq(hotelModules.module, "guests")));
  return !!m?.enabled;
}

export async function setGuestsModule(hotelId: string, enabled: boolean, actor: string) {
  await db().transaction(async (tx) => {
    await tx.insert(hotelModules).values({ hotelId, module: "guests", enabled })
      .onConflictDoUpdate({ target: [hotelModules.hotelId, hotelModules.module], set: { enabled } });
    await audit(tx, { hotelId, actor, action: enabled ? "module.guests.on" : "module.guests.off", entity: "hotel", entityId: hotelId });
  });
}

export type CantonRule = { canton: string; retentionYears: number; retentionKnown: boolean; signatureRequired: boolean; groupListAllowed: boolean; notes: string | null; sourceUrl: string | null };

export async function cantonRule(canton: string): Promise<CantonRule> {
  const [r] = await db().select().from(cantonRules).where(eq(cantonRules.canton, canton));
  return {
    canton,
    // SPEC 14: nicht geregelt → 5 Jahre verwenden
    retentionYears: r?.retentionYears ?? 5,
    retentionKnown: r?.retentionYears != null,
    signatureRequired: r?.signatureRequired ?? false,
    groupListAllowed: r?.groupListAllowed ?? false,
    notes: r?.notes ?? null,
    sourceUrl: r?.sourceUrl ?? null,
  };
}

/** Gruppen ab dieser Personenzahl dürfen (wo der Kanton es erlaubt) eine Teilnehmerliste abgeben (SPEC 14.3: «> 5 Personen») */
export const GROUP_MIN_PERSONS = 6;

export function retentionUntil(departure: string, years: number): string {
  const [y, m, d] = departure.split("-").map(Number);
  // 29. Februar → 1. März (eher länger als kürzer aufbewahren)
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- Check-in-Link (Job)

/**
 * Reiht den Check-in-Link für bestätigte Buchungen ein: 7 Tage vor Anreise um 10:00 Hotelzeit, bei späterer Buchung sofort.
 * Läuft regelmässig im Worker; die Outbox verhindert Doppelversand (booking/template/to eindeutig).
 */
export async function enqueueCheckinLinks(now = new Date()): Promise<number> {
  const due = rows<{ id: string; hotel_id: string; checkin: string; language: string; email: string; timezone: string }>(
    await db().execute(sql`
      SELECT b.id, b.hotel_id, b.checkin::text, b.language, g.email, h.timezone
        FROM bookings b
        JOIN hotels h ON h.id = b.hotel_id
        JOIN hotel_modules m ON m.hotel_id = b.hotel_id AND m.module = 'guests' AND m.enabled
        JOIN guests g ON g.id = b.guest_id
       WHERE b.status = 'confirmed'
         AND g.email IS NOT NULL AND g.email <> ''
         AND b.checkin >= (${now.toISOString()}::timestamptz AT TIME ZONE h.timezone)::date
         AND b.checkin <= (${now.toISOString()}::timestamptz AT TIME ZONE h.timezone)::date + 7
         AND NOT EXISTS (SELECT 1 FROM guest_registrations r WHERE r.booking_id = b.id)
         AND NOT EXISTS (SELECT 1 FROM email_outbox o WHERE o.booking_id = b.id AND o.template = 'checkin_link')`),
  );
  for (const b of due) {
    const at = zonedToUtc(addDays(b.checkin, -7), "10:00", b.timezone);
    await enqueueEmail(db(), { hotelId: b.hotel_id, bookingId: b.id, template: "checkin_link", to: b.email, language: b.language, data: { bookingId: b.id }, sendAfter: at < now ? now : at });
  }
  return due.length;
}

// ---------------------------------------------------------------- Formular

const day = z.string().refine(isDay, "date");
const country = z.string().trim().toUpperCase().refine(isCountry, "country");
const name = z.string().trim().min(1).max(100);
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);

const fullPerson = z.object({
  firstName: name, lastName: name,
  sex: z.enum(["f", "m", "x"]).optional().or(z.literal("").transform(() => undefined)),
  birthDate: day, nationality: country,
  sameAddress: z.boolean().optional(),
  street: opt(200), postalCode: opt(20), city: opt(100), country: country.optional().or(z.literal("").transform(() => undefined)),
  docType: z.enum(["passport", "id_card", "residence_permit", "other"]).optional().or(z.literal("").transform(() => undefined)),
  docNumber: opt(40),
  vehiclePlate: opt(20),
});
const listPerson = z.object({ firstName: name, lastName: name, birthDate: day, nationality: country });

export const checkinSchema = z.object({
  persons: z.array(fullPerson).min(1).max(30),
  participants: z.array(listPerson).max(100).default([]),
  signature: z.string().max(300_000).optional(),
  confirm: z.boolean(),
});
export type CheckinInput = z.input<typeof checkinSchema>;

export class CheckinError extends Error {
  constructor(public code: "invalid" | "signature" | "confirm" | "locked" | "not_found" | "closed", public fields: string[] = []) {
    super(code);
  }
}

export async function checkinContext(token: string) {
  const [booking] = await db().select().from(bookings).where(eq(bookings.publicToken, token));
  if (!booking) return null;
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, booking.hotelId));
  const enabled = await guestsModuleEnabled(hotel.id);
  const rule = await cantonRule(hotel.canton);
  const regs = await db().select().from(guestRegistrations).where(eq(guestRegistrations.bookingId, booking.id)).orderBy(asc(guestRegistrations.createdAt));
  const persons = booking.adults + booking.children;
  const [guest] = booking.guestId ? await db().select().from(guests).where(eq(guests.id, booking.guestId)) : [];
  const open = enabled && booking.status === "confirmed" && booking.checkout >= todayIn(hotel.timezone);
  return {
    booking, hotel, rule, guest, persons, open,
    groupMode: rule.groupListAllowed && persons >= GROUP_MIN_PERSONS,
    submitted: regs.length > 0,
    verified: regs.some((r) => r.verifiedByStaffAt),
  };
}

/** Speichert den Meldeschein (ersetzt einen früheren, solange das Personal noch nicht bestätigt hat) */
export async function submitCheckin(token: string, input: unknown, now = new Date()) {
  const ctx = await checkinContext(token);
  if (!ctx) throw new CheckinError("not_found");
  if (!ctx.open) throw new CheckinError("closed");
  if (ctx.verified) throw new CheckinError("locked");
  const { booking, hotel, rule } = ctx;

  const parsed = checkinSchema.safeParse(input);
  if (!parsed.success) {
    throw new CheckinError("invalid", parsed.error.issues.map((i) => i.path.join(".")));
  }
  const v = parsed.data;
  const fields: string[] = [];
  const total = v.persons.length + v.participants.length;
  if (ctx.groupMode) {
    if (v.persons.length !== 1 || total > ctx.persons) fields.push("persons");
  } else if (v.persons.length !== ctx.persons || v.participants.length) fields.push("persons");

  const p1 = v.persons[0];
  const ages: number[] = [];
  v.persons.forEach((p, i) => {
    const age = ageOn(p.birthDate, booking.checkin);
    ages.push(age);
    if (p.birthDate > todayIn(hotel.timezone, now) || age > 120) fields.push(`persons.${i}.birthDate`);
    const addr = i > 0 && p.sameAddress ? p1 : p;
    for (const k of ["street", "postalCode", "city", "country"] as const) if (!addr[k]) fields.push(`persons.${i}.${i > 0 && p.sameAddress ? "sameAddress" : k}`);
    // ASSUMPTION: Ausweis ist für Erwachsene Pflicht; Kinder ohne eigenen Ausweis dürfen die Felder leer lassen (QUESTIONS.md)
    if (age >= 18 || p.docType || p.docNumber) {
      if (!p.docType) fields.push(`persons.${i}.docType`);
      if (!p.docNumber) fields.push(`persons.${i}.docNumber`);
    }
  });
  v.participants.forEach((p, i) => {
    if (p.birthDate > todayIn(hotel.timezone, now) || ageOn(p.birthDate, booking.checkin) > 120) fields.push(`participants.${i}.birthDate`);
  });
  if (fields.length) throw new CheckinError("invalid", [...new Set(fields)]);
  if (rule.signatureRequired && !/^data:image\/png;base64,[A-Za-z0-9+/=]{200,}$/.test(v.signature ?? "")) throw new CheckinError("signature", ["signature"]);
  if (!v.confirm) throw new CheckinError("confirm", ["confirm"]);

  const taxRule = await taxRuleFor(hotel, booking.checkin);
  const liable = (age: number) => (taxRule ? ratePerPerson(taxRule, age, false) > 0 : true);
  const [room] = await db().select({ name: roomTypes.name }).from(bookingRooms).innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId)).where(eq(bookingRooms.bookingId, booking.id));
  const base = {
    hotelId: hotel.id, bookingId: booking.id, arrivalDate: booking.checkin, departureDate: booking.checkout,
    roomLabel: room?.name ?? null, confirmedByGuestAt: now, retentionUntil: retentionUntil(booking.checkout, rule.retentionYears),
  };
  const values = [
    ...v.persons.map((p, i) => {
      const addr = i > 0 && p.sameAddress ? p1 : p;
      return {
        ...base, isPrimary: i === 0, listOnly: false,
        firstName: p.firstName, lastName: p.lastName, sex: p.sex ?? null,
        birthDateEnc: encryptField(p.birthDate), ageAtArrival: ages[i], nationality: p.nationality,
        street: addr.street ?? null, postalCode: addr.postalCode ?? null, city: addr.city ?? null, country: addr.country ?? null,
        idDocumentType: p.docType ?? null, idDocumentNumberEnc: encryptOpt(p.docNumber),
        vehiclePlate: p.vehiclePlate ?? null, touristTaxLiable: liable(ages[i]),
        signaturePngEnc: i === 0 && rule.signatureRequired ? encryptField(v.signature!) : null,
      };
    }),
    ...v.participants.map((p) => {
      const age = ageOn(p.birthDate, booking.checkin);
      return {
        ...base, isPrimary: false, listOnly: true, firstName: p.firstName, lastName: p.lastName,
        birthDateEnc: encryptField(p.birthDate), ageAtArrival: age, nationality: p.nationality, touristTaxLiable: liable(age),
      };
    }),
  ];
  await db().transaction(async (tx) => {
    // erneut prüfen, falls das Personal inzwischen bestätigt hat
    const locked = await tx.execute(sql`SELECT 1 FROM guest_registrations WHERE booking_id = ${booking.id} AND verified_by_staff_at IS NOT NULL FOR UPDATE`);
    if (rows(locked).length) throw new CheckinError("locked");
    await tx.delete(guestRegistrations).where(eq(guestRegistrations.bookingId, booking.id));
    await tx.insert(guestRegistrations).values(values);
    await audit(tx, { hotelId: hotel.id, actor: "guest", action: ctx.submitted ? "guest.checkin_updated" : "guest.checkin_submitted", entity: "booking", entityId: booking.id, details: { persons: values.length } });
  });
  await registrationReporter(hotel).report(booking.id).catch((e) => console.error("[registration-reporter]", e));
  return { persons: values.length };
}

// ---------------------------------------------------------------- Admin: Tagesliste

export type Arrival = {
  bookingId: string; reference: string; source: string; guest: string; persons: number; room: string | null; checkout: string;
  registered: number; verified: boolean; names: string[];
};

export async function arrivals(hotelId: string, dayStr: string): Promise<Arrival[]> {
  const list = rows<{ id: string; reference: string; source: string; guest: string; persons: number; room: string | null; checkout: string }>(
    await db().execute(sql`
      SELECT b.id, b.reference, b.source, coalesce(g.first_name || ' ' || g.last_name, '') AS guest,
             (b.adults + b.children)::int AS persons, b.checkout::text,
             (SELECT string_agg(rt.name, ', ') FROM booking_rooms br JOIN room_types rt ON rt.id = br.room_type_id WHERE br.booking_id = b.id) AS room
        FROM bookings b LEFT JOIN guests g ON g.id = b.guest_id
       WHERE b.hotel_id = ${hotelId} AND b.checkin = ${dayStr} AND b.status = 'confirmed'
       ORDER BY g.last_name NULLS LAST, b.reference`),
  );
  if (!list.length) return [];
  const regs = await db().select({ bookingId: guestRegistrations.bookingId, firstName: guestRegistrations.firstName, lastName: guestRegistrations.lastName, verified: guestRegistrations.verifiedByStaffAt })
    .from(guestRegistrations).where(and(eq(guestRegistrations.hotelId, hotelId), inArray(guestRegistrations.bookingId, list.map((l) => l.id))));
  return list.map((l) => {
    const r = regs.filter((x) => x.bookingId === l.id);
    return { bookingId: l.id, reference: l.reference, source: l.source, guest: l.guest, persons: l.persons, room: l.room, checkout: l.checkout,
      registered: r.length, verified: r.length > 0 && r.every((x) => x.verified), names: r.map((x) => `${x.firstName} ${x.lastName}`) };
  });
}

/** Personal hat den Ausweis gesehen (SPEC 14.4) */
export async function verifyRegistration(hotelId: string, bookingId: string, actor: string) {
  await db().transaction(async (tx) => {
    const r = await tx.update(guestRegistrations).set({ verifiedByStaffAt: new Date() })
      .where(and(eq(guestRegistrations.hotelId, hotelId), eq(guestRegistrations.bookingId, bookingId), sql`verified_by_staff_at IS NULL`))
      .returning({ id: guestRegistrations.id });
    if (r.length) await audit(tx, { hotelId, actor, action: "guest.verified", entity: "booking", entityId: bookingId, details: { persons: r.length } });
  });
}

// ---------------------------------------------------------------- Admin: Register-Export

export type RegisterRow = Omit<GuestRegistration, "birthDateEnc" | "idDocumentNumberEnc" | "signaturePngEnc"> & {
  birthDate: string | null; idDocumentNumber: string | null; hasSignature: boolean; reference: string;
};

export async function registerRows(hotelId: string, from: string, to: string): Promise<RegisterRow[]> {
  if (!isDay(from) || !isDay(to) || from > to) throw new Error("Zeitraum ungültig");
  const list = await db().select({ r: guestRegistrations, reference: bookings.reference }).from(guestRegistrations)
    .innerJoin(bookings, eq(bookings.id, guestRegistrations.bookingId))
    .where(and(eq(guestRegistrations.hotelId, hotelId), sql`${guestRegistrations.arrivalDate} BETWEEN ${from} AND ${to}`))
    .orderBy(asc(guestRegistrations.arrivalDate), asc(bookings.reference), sql`${guestRegistrations.isPrimary} DESC`, asc(guestRegistrations.createdAt));
  return list.map(({ r, reference }) => {
    const { birthDateEnc, idDocumentNumberEnc, signaturePngEnc, ...rest } = r;
    return { ...rest, reference, birthDate: decryptField(birthDateEnc), idDocumentNumber: decryptField(idDocumentNumberEnc), hasSignature: !!signaturePngEnc };
  });
}

/** Unterschrift (für den Druck) */
export async function registrationSignature(hotelId: string, id: string): Promise<string | null> {
  const [r] = await db().select({ s: guestRegistrations.signaturePngEnc }).from(guestRegistrations).where(and(eq(guestRegistrations.hotelId, hotelId), eq(guestRegistrations.id, id)));
  return decryptField(r?.s);
}

/** Jeder Export (CSV oder Druck) wird protokolliert (SPEC 14.7) */
export async function logRegisterExport(hotelId: string, from: string, to: string, format: "csv" | "pdf", count: number, actor: string) {
  await db().transaction(async (tx) => {
    await tx.update(guestRegistrations).set({ exportedAt: new Date() })
      .where(and(eq(guestRegistrations.hotelId, hotelId), sql`${guestRegistrations.arrivalDate} BETWEEN ${from} AND ${to}`));
    await audit(tx, { hotelId, actor, action: "guest.register_export", entity: "guest_registrations", details: { from, to, format, count } });
  });
}

const DOC_DE: Record<string, string> = { passport: "Pass", id_card: "Identitätskarte", residence_permit: "Ausländerausweis", other: "anderer Ausweis" };
export const docLabel = (t: string | null) => (t ? DOC_DE[t] ?? t : "");

export function registerCsv(list: RegisterRow[]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Buchung", "Anreise", "Abreise", "Zimmer", "Hauptperson", "Nachname", "Vorname", "Geschlecht", "Geburtsdatum", "Nationalität",
    "Strasse", "PLZ", "Ort", "Land", "Ausweistyp", "Ausweisnummer", "Autokennzeichen", "Kurtaxepflichtig", "Unterschrift", "Vom Gast bestätigt", "Ausweis gesehen"];
  const ts = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "");
  const lines = list.map((r) => [r.reference, r.arrivalDate, r.departureDate, r.roomLabel, r.isPrimary ? "ja" : r.listOnly ? "Teilnehmerliste" : "nein",
    r.lastName, r.firstName, r.sex, r.birthDate, r.nationality, r.street, r.postalCode, r.city, r.country, docLabel(r.idDocumentType), r.idDocumentNumber,
    r.vehiclePlate, r.touristTaxLiable ? "ja" : "nein", r.hasSignature ? "ja" : "", ts(r.confirmedByGuestAt), ts(r.verifiedByStaffAt)].map(esc).join(";"));
  return "﻿" + [head.join(";"), ...lines].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- Kurtaxe-Liste pro Monat

export type TaxListLine = {
  bookingId: string; reference: string; source: string; guest: string; checkin: string; checkout: string;
  nightsInMonth: number; liable: number; exempt: number; unknownAge: number; personNights: number; amountRappen: number; fromRegister: boolean;
};

/**
 * Kurtaxe-Liste (SPEC 14.5): alle bestätigten Aufenthalte mit Nächten im Monat, auch Portal-Buchungen.
 * Mit Meldeschein: nach Alter laut Meldeschein. Ohne: Erwachsene gemäss Buchung, Kinder nach angegebenem Alter (sonst «Alter unbekannt»).
 */
// ASSUMPTION: Stichtag ist die Übernachtung (Nächte im Monat), nicht die Anreise; Satz gemäss Regel am Anreisetag.
export async function touristTaxList(hotel: Hotel, month: string) {
  const first = `${month}-01`;
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const list = await db().select().from(bookings)
    .where(and(eq(bookings.hotelId, hotel.id), inArray(bookings.status, ["confirmed", "no_show"]), sql`${bookings.checkin} < ${next} AND ${bookings.checkout} > ${first}`))
    .orderBy(asc(bookings.checkin));
  const guestNames = new Map<string, string>();
  const gids = list.map((b) => b.guestId).filter((x): x is string => !!x);
  if (gids.length) for (const g of await db().select().from(guests).where(inArray(guests.id, gids))) guestNames.set(g.id, `${g.firstName} ${g.lastName}`);
  const regs = list.length ? await db().select({ bookingId: guestRegistrations.bookingId, age: guestRegistrations.ageAtArrival, liable: guestRegistrations.touristTaxLiable })
    .from(guestRegistrations).where(and(eq(guestRegistrations.hotelId, hotel.id), inArray(guestRegistrations.bookingId, list.map((b) => b.id)))) : [];

  const lines: TaxListLine[] = [];
  for (const b of list) {
    const from = b.checkin > first ? b.checkin : first;
    const to = b.checkout < next ? b.checkout : next;
    const nights = diffDays(from, to);
    const rule = await taxRuleFor(hotel, b.checkin);
    const r = regs.filter((x) => x.bookingId === b.id);
    let liable = 0, exempt = 0, unknownAge = 0, perNight = 0;
    const add = (age: number | null, isChild: boolean) => {
      const rate = rule ? ratePerPerson(rule, age, isChild) : 0;
      if (age === null && isChild) unknownAge++;
      if (rate > 0) { liable++; perNight += rate; } else exempt++;
    };
    if (r.length) for (const x of r) add(x.age, false);
    else {
      for (let i = 0; i < b.adults; i++) add(null, false);
      for (let i = 0; i < b.children; i++) add(b.childrenAges[i] ?? null, true);
    }
    lines.push({ bookingId: b.id, reference: b.reference, source: b.source, guest: b.guestId ? guestNames.get(b.guestId) ?? "" : "", checkin: b.checkin, checkout: b.checkout,
      nightsInMonth: nights, liable, exempt, unknownAge, personNights: liable * nights, amountRappen: perNight * nights, fromRegister: r.length > 0 });
  }
  const total = lines.reduce((t, l) => ({ nights: t.nights + l.nightsInMonth, liable: t.liable + l.liable, exempt: t.exempt + l.exempt, personNights: t.personNights + l.personNights, amountRappen: t.amountRappen + l.amountRappen }),
    { nights: 0, liable: 0, exempt: 0, personNights: 0, amountRappen: 0 });
  return { month, lines, total };
}

export function taxListCsv(r: Awaited<ReturnType<typeof touristTaxList>>): string {
  const head = ["Buchung", "Quelle", "Gast", "Anreise", "Abreise", "Nächte im Monat", "Personen pflichtig", "Personen befreit", "Logiernächte pflichtig", "Kurtaxe CHF", "Grundlage"];
  const lines = r.lines.map((l) => [l.reference, l.source, l.guest, l.checkin, l.checkout, l.nightsInMonth, l.liable, l.exempt, l.personNights, (l.amountRappen / 100).toFixed(2), l.fromRegister ? "Meldeschein" : `Buchung${l.unknownAge ? ` (${l.unknownAge} Kind/er Alter unbekannt)` : ""}`]
    .map((v) => { const s = String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(";"));
  const t = r.total;
  lines.push(["Total", "", "", "", "", t.nights, t.liable, t.exempt, t.personNights, (t.amountRappen / 100).toFixed(2), ""].join(";"));
  return "﻿" + [head.join(";"), ...lines].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- Löschjob

/** Täglich: Einträge nach Ablauf der Aufbewahrungsfrist löschen (inkl. Unterschrift). Der Tag retention_until selbst bleibt. */
export async function purgeExpiredRegistrations(now = new Date()): Promise<number> {
  return db().transaction(async (tx) => {
    const del = rows<{ hotel_id: string; n: number }>(await tx.execute(sql`
      WITH d AS (
        DELETE FROM guest_registrations r USING hotels h
         WHERE h.id = r.hotel_id AND r.retention_until < (${now.toISOString()}::timestamptz AT TIME ZONE h.timezone)::date
        RETURNING r.hotel_id)
      SELECT hotel_id, count(*)::int AS n FROM d GROUP BY hotel_id`));
    for (const d of del) await audit(tx, { hotelId: d.hotel_id, actor: "system", action: "guest.retention_purge", entity: "guest_registrations", details: { deleted: d.n } });
    return del.reduce((a, d) => a + d.n, 0);
  });
}

