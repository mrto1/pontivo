import { UserError } from "../domain/errors";
import { and, asc, eq, sql } from "drizzle-orm";
import { insertFolioItem } from "./folio";
import { db, rows } from "../db/client";
import { bookings, folioItems, guests, resourceBookings, resources, type Resource, type ResourceBooking } from "../db/schema";
import { freeSeats, parseHhmm, priceOf, validRange } from "../domain/resources";
import { audit } from "./audit";

/** Angebote vor Ort (SPEC 19.11). Jede Abfrage nach hotel_id. */
export class ResourceError extends UserError {}

export type ResourceInput = { name: string; kind: Resource["kind"]; capacity: number; slotMinutes: number; openFrom: string; openTo: string; priceRappen: number; pricePerPerson: boolean; vatKind: Resource["vatKind"]; active?: boolean };

export const listResources = (hotelId: string, onlyActive = false) =>
  db().select().from(resources).where(onlyActive ? and(eq(resources.hotelId, hotelId), eq(resources.active, true)) : eq(resources.hotelId, hotelId)).orderBy(asc(resources.name));

export async function saveResource(hotelId: string, id: string | null, i: ResourceInput, actor: string): Promise<Resource> {
  const name = i.name.trim().slice(0, 100);
  if (!name) throw new ResourceError("Der Name fehlt.");
  if (!["wellness", "seminar", "sport", "other"].includes(i.kind)) throw new ResourceError("Ungültige Art.");
  if (!["stay", "standard", "none"].includes(i.vatKind)) throw new ResourceError("Ungültige MWST-Art.");
  if (!Number.isInteger(i.capacity) || i.capacity < 1 || i.capacity > 500) throw new ResourceError("Plätze: 1 bis 500.");
  if (!Number.isInteger(i.slotMinutes) || i.slotMinutes < 15 || i.slotMinutes > 480) throw new ResourceError("Fensterlänge: 15 bis 480 Minuten.");
  const from = parseHhmm(i.openFrom), to = i.openTo.trim() === "24:00" ? 1440 : parseHhmm(i.openTo);
  if (from === null || to === null || to <= from) throw new ResourceError("Öffnungszeit ungültig (HH:MM, Schluss nach Beginn).");
  if (to - from < i.slotMinutes) throw new ResourceError("Die Öffnungszeit ist kürzer als ein Zeitfenster.");
  if (!Number.isInteger(i.priceRappen) || i.priceRappen < 0 || i.priceRappen > 10_000_000) throw new ResourceError("Preis ungültig.");
  const v = { name, kind: i.kind, capacity: i.capacity, slotMinutes: i.slotMinutes, openFrom: from, openTo: to, priceRappen: i.priceRappen, pricePerPerson: i.pricePerPerson, vatKind: i.vatKind, active: i.active ?? true };
  return db().transaction(async (tx) => {
    let r: Resource;
    if (id) {
      [r] = await tx.update(resources).set(v).where(and(eq(resources.id, id), eq(resources.hotelId, hotelId))).returning();
      if (!r) throw new ResourceError("Angebot nicht gefunden.");
    } else {
      [r] = await tx.insert(resources).values({ ...v, hotelId }).returning();
    }
    await audit(tx, { hotelId, actor, action: id ? "resource.update" : "resource.create", entity: "resource", entityId: r.id });
    return r;
  });
}

export type ResourceBookingInput = { resourceId: string; day: string; start: string; end: string; persons: number; guestName: string; bookingReference?: string; note?: string };

/**
 * Buchung eines Zeitraums. Die Ressource wird gesperrt (FOR UPDATE), damit zwei gleichzeitige Buchungen die Plätze nicht überbuchen.
 * Mit Buchungsnummer eines Hausgasts wird der Preis als Posten aufs Zimmer gebucht (`folio_items`, kommt auf die Rechnung).
 */
export async function createResourceBooking(hotelId: string, i: ResourceBookingInput, actor: string): Promise<ResourceBooking> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.day)) throw new ResourceError("Datum ungültig.");
  const start = parseHhmm(i.start), end = i.end.trim() === "24:00" ? 1440 : parseHhmm(i.end);
  if (start === null || end === null) throw new ResourceError("Zeit ungültig (HH:MM).");
  if (!Number.isInteger(i.persons) || i.persons < 1) throw new ResourceError("Mindestens eine Person.");
  const note = (i.note ?? "").trim().slice(0, 300);
  return db().transaction(async (tx) => {
    const lock = rows<{ id: string }>(await tx.execute(sql`SELECT id FROM resources WHERE id = ${i.resourceId} AND hotel_id = ${hotelId} FOR UPDATE`));
    if (!lock.length) throw new ResourceError("Angebot nicht gefunden.");
    const [r] = await tx.select().from(resources).where(and(eq(resources.id, i.resourceId), eq(resources.hotelId, hotelId)));
    if (!r.active) throw new ResourceError("Dieses Angebot ist nicht aktiv.");
    if (!validRange(r, start, end)) throw new ResourceError("Der Zeitraum liegt ausserhalb der Öffnungszeit oder nicht im Zeitraster.");
    if (i.persons > r.capacity) throw new ResourceError(`Höchstens ${r.capacity} Personen.`);
    // Seminarräume sind exklusiv: eine Buchung belegt den ganzen Raum
    const used = (p: number) => (r.kind === "seminar" ? r.capacity : p);
    const taken = (await tx.select().from(resourceBookings).where(and(eq(resourceBookings.hotelId, hotelId), eq(resourceBookings.resourceId, r.id), eq(resourceBookings.day, i.day), eq(resourceBookings.status, "confirmed"))))
      .map((t) => ({ startMin: t.startMin, endMin: t.endMin, persons: used(t.persons) }));
    if (freeSeats(r, taken, start, end) < used(i.persons)) throw new ResourceError("In diesem Zeitraum sind nicht genug Plätze frei.");
    let bookingId: string | null = null;
    let guestName = i.guestName.trim().slice(0, 120);
    if (i.bookingReference?.trim()) {
      const [b] = await tx.select({ id: bookings.id, status: bookings.status, guestId: bookings.guestId }).from(bookings).where(and(eq(bookings.hotelId, hotelId), eq(bookings.reference, i.bookingReference.trim().toUpperCase())));
      if (!b || b.status !== "confirmed") throw new ResourceError("Buchungsnummer nicht gefunden oder nicht bestätigt.");
      bookingId = b.id;
      if (!guestName && b.guestId) {
        const [g] = await tx.select({ f: guests.firstName, l: guests.lastName }).from(guests).where(and(eq(guests.id, b.guestId), eq(guests.hotelId, hotelId)));
        guestName = g ? `${g.f} ${g.l}`.trim() : "";
      }
    }
    if (!guestName) throw new ResourceError("Bitte den Namen des Gasts angeben.");
    const price = priceOf(r, start, end, i.persons);
    let folioItemId: string | null = null;
    if (bookingId && price > 0) {
      const f = (await insertFolioItem(tx, { hotelId, bookingId, description: `${r.name} ${i.day} ${i.start}–${i.end}${r.pricePerPerson ? ` (${i.persons} P.)` : ""}`, quantity: 1, unitPriceRappen: price, vatKind: r.vatKind, createdBy: actor }))!;
      folioItemId = f.id;
    }
    const [rb] = await tx.insert(resourceBookings).values({ hotelId, resourceId: r.id, bookingId, folioItemId, guestName, day: i.day, startMin: start, endMin: end, persons: i.persons, priceRappen: price, note, createdBy: actor }).returning();
    await audit(tx, { hotelId, actor, action: "resource.book", entity: "resource", entityId: r.id, details: { day: i.day, start, end, persons: i.persons, priceRappen: price, bookingId } });
    return rb;
  });
}

/** Stornieren. Steht der Posten schon auf einer Rechnung, geht es nur per Gutschrift. */
export async function cancelResourceBooking(hotelId: string, id: string, actor: string) {
  await db().transaction(async (tx) => {
    const [rb] = await tx.select().from(resourceBookings).where(and(eq(resourceBookings.id, id), eq(resourceBookings.hotelId, hotelId)));
    if (!rb) throw new ResourceError("Buchung nicht gefunden.");
    if (rb.status === "cancelled") return;
    if (rb.folioItemId) {
      const [f] = await tx.select({ invoiceId: folioItems.invoiceId }).from(folioItems).where(and(eq(folioItems.id, rb.folioItemId), eq(folioItems.hotelId, hotelId)));
      if (f?.invoiceId) throw new ResourceError("Der Posten steht schon auf einer Rechnung. Korrektur per Gutschrift.");
      await tx.delete(folioItems).where(and(eq(folioItems.id, rb.folioItemId), eq(folioItems.hotelId, hotelId)));
    }
    await tx.update(resourceBookings).set({ status: "cancelled", folioItemId: null }).where(eq(resourceBookings.id, id));
    await audit(tx, { hotelId, actor, action: "resource.cancel", entity: "resource", entityId: rb.resourceId, details: { day: rb.day, bookingId: rb.bookingId } });
  });
}

export async function listDay(hotelId: string, day: string) {
  return db().select({ rb: resourceBookings, resource: resources.name }).from(resourceBookings)
    .innerJoin(resources, eq(resources.id, resourceBookings.resourceId))
    .where(and(eq(resourceBookings.hotelId, hotelId), eq(resourceBookings.day, day), eq(resourceBookings.status, "confirmed")))
    .orderBy(asc(resources.name), asc(resourceBookings.startMin));
}
