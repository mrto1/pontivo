import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { bookings, guestRequests, type GuestRequest, type Hotel } from "../db/schema";
import { MAX_OPEN_REQUESTS, MAX_REQUESTS_PER_BOOKING, requestsEnabled, selfCheckoutEnabled, selfCheckoutOpen, wishLabel, wishOptions } from "../domain/portal";
import { enqueueEmail } from "../email/enqueue";
import { enqueuePush } from "../push/service";
import { audit } from "./audit";

/**
 * Gästewünsche (SPEC 19.41): der Gast meldet über seinen Buchungslink einen Wunsch aus der Liste des Betriebs und/oder
 * einen freien Text. Der Wunsch gehört zur Buchung, erscheint im Posteingang (Push + Mail ans Hotel) und trägt einen Status,
 * den der Gast sieht. Der Link ist der einzige Zugang, darum gibt es Obergrenzen pro Buchung.
 */
export class RequestError extends Error {
  constructor(public code: "closed" | "disabled" | "empty" | "unknown_wish" | "too_many_open" | "too_many", message?: string) { super(message ?? code); }
}

export const MAX_MESSAGE = 500;

/** Wünsche sind nur für bestätigte Buchungen möglich, bis zum Abreisetag (Hotelzeit) */
export function requestsOpen(b: { status: string; checkout: string }, today: string): boolean {
  return b.status === "confirmed" && today <= b.checkout;
}

export async function createGuestRequest(hotel: Hotel, bookingId: string, input: { itemId?: string; message?: string }, today: string, lang: string): Promise<GuestRequest> {
  const message = (input.message ?? "").trim().slice(0, MAX_MESSAGE);
  const portal = hotel.content.portal;
  if (!requestsEnabled(portal)) throw new RequestError("disabled");
  let itemId = "", label = "";
  if (input.itemId) {
    const opt = wishOptions(portal).find((o) => o.id === input.itemId);
    if (!opt) throw new RequestError("unknown_wish");
    itemId = opt.id;
    // Beschriftung in der Sprache des Hotels merken, damit die Rezeption sie versteht (der Gast sieht seine Sprache)
    label = wishLabel(opt, hotel.defaultLanguage);
  } else if (message) {
    label = "Wunsch";
  } else {
    throw new RequestError("empty");
  }
  return db().transaction(async (tx) => {
    // Buchung sperren: gleichzeitige Absendungen dürfen die Grenzen nicht umgehen
    const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotel.id))).for("update");
    if (!b || !requestsOpen(b, today)) throw new RequestError("closed");
    const [c] = await tx.select({ total: sql<number>`count(*)::int`, open: sql<number>`count(*) filter (where status = 'open')::int` })
      .from(guestRequests).where(and(eq(guestRequests.hotelId, hotel.id), eq(guestRequests.bookingId, bookingId)));
    if (c.total >= MAX_REQUESTS_PER_BOOKING) throw new RequestError("too_many");
    if (c.open >= MAX_OPEN_REQUESTS) throw new RequestError("too_many_open");
    const [row] = await tx.insert(guestRequests).values({ hotelId: hotel.id, bookingId, itemId, label, message }).returning();
    await enqueueEmail(tx, {
      hotelId: hotel.id, bookingId: null, template: "guest_request", to: hotel.contactEmail, language: hotel.defaultLanguage,
      // bookingId bewusst leer: die Mail-Warteschlange lässt sonst nur eine Mail je Buchung und Vorlage zu, jeder Wunsch soll aber ankommen
      data: { requestId: row.id, bookingId, reference: b.reference, label, message, checkin: b.checkin, checkout: b.checkout, guestLanguage: lang },
    });
    await enqueuePush(tx, hotel.id, `guest_request:${row.id}`, { title: `Gästewunsch · ${b.reference}`, body: [label, message].filter(Boolean).join(": ").slice(0, 140), url: `/mypontivo/${hotel.id}/inbox?quelle=wuensche` });
    await audit(tx, { hotelId: hotel.id, actor: "guest", action: "guest_request.create", entity: "guest_request", entityId: row.id, details: { bookingId, itemId } });
    return row;
  });
}

export async function requestsOfBooking(hotelId: string, bookingId: string): Promise<GuestRequest[]> {
  return db().select().from(guestRequests).where(and(eq(guestRequests.hotelId, hotelId), eq(guestRequests.bookingId, bookingId))).orderBy(desc(guestRequests.createdAt));
}

/** Für den Posteingang: offene zuerst, dann die zuletzt erledigten; mit Buchungsnummer und Zeitraum */
export async function listGuestRequests(hotelId: string, limit = 200) {
  return db().select({ r: guestRequests, reference: bookings.reference, checkin: bookings.checkin, checkout: bookings.checkout, bookingId: bookings.id })
    .from(guestRequests).innerJoin(bookings, eq(bookings.id, guestRequests.bookingId))
    .where(and(eq(guestRequests.hotelId, hotelId), eq(bookings.hotelId, hotelId)))
    .orderBy(asc(sql`case when ${guestRequests.status} = 'open' then 0 else 1 end`), desc(guestRequests.createdAt)).limit(limit);
}

export async function openGuestRequestCount(hotelId: string): Promise<number> {
  const [r] = await db().select({ n: sql<number>`count(*)::int` }).from(guestRequests).where(and(eq(guestRequests.hotelId, hotelId), eq(guestRequests.status, "open")));
  return r?.n ?? 0;
}

export async function setGuestRequestDone(hotelId: string, id: string, done: boolean, actor: string, note = ""): Promise<boolean> {
  return db().transaction(async (tx) => {
    const r = await tx.update(guestRequests)
      .set(done ? { status: "done", doneAt: new Date(), doneBy: actor, note: note.trim().slice(0, 300) } : { status: "open", doneAt: null, doneBy: null })
      .where(and(eq(guestRequests.id, id), eq(guestRequests.hotelId, hotelId))).returning();
    if (r.length) await audit(tx, { hotelId, actor, action: done ? "guest_request.done" : "guest_request.reopen", entity: "guest_request", entityId: id });
    return r.length > 0;
  });
}

/**
 * Selbst-Check-out (SPEC 19.41): der Gast meldet am Abreisetag, dass er geht. Die Buchung bleibt «bestätigt» (Rechnung, Zahlung
 * und Reinigung laufen wie bisher); es gibt einen Vermerk unter «Tag» und einen Eintrag im Posteingang, damit die Rezeption
 * Schlüssel/Zimmer prüft und offene Posten abschliesst. Idempotent: zweiter Aufruf tut nichts.
 */
export async function selfCheckout(hotel: Hotel, bookingId: string, today: string): Promise<"done" | "already"> {
  if (!selfCheckoutEnabled(hotel.content.portal)) throw new RequestError("disabled");
  return db().transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotel.id))).for("update");
    if (!b || b.status !== "confirmed") throw new RequestError("closed");
    if (b.guestCheckoutAt) return "already";
    if (!selfCheckoutOpen(b, today, true)) throw new RequestError("closed");
    await tx.update(bookings).set({ guestCheckoutAt: new Date() }).where(and(eq(bookings.id, b.id), eq(bookings.hotelId, hotel.id)));
    const [row] = await tx.insert(guestRequests).values({ hotelId: hotel.id, bookingId, itemId: "checkout", label: "Check-out durch den Gast", message: "" }).returning();
    await enqueuePush(tx, hotel.id, `guest_checkout:${b.id}`, { title: `Check-out · ${b.reference}`, body: "Der Gast hat im Portal ausgecheckt.", url: `/mypontivo/${hotel.id}/inbox?quelle=wuensche` });
    await audit(tx, { hotelId: hotel.id, actor: "guest", action: "booking.self_checkout", entity: "booking", entityId: b.id, details: { requestId: row.id } });
    return "done";
  });
}
