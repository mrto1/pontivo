import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, rows } from "../db/client";
import { hotels, inquiries, offerLines, offers, resources, type Hotel, type Offer, type OfferLine } from "../db/schema";
import { addDays, todayIn } from "../domain/dates";
import { newPublicToken } from "../domain/ids";
import { offerOpen } from "../domain/offers";
import { hhmm, parseHhmm, priceOf } from "../domain/resources";
import { enqueueEmail } from "../email/enqueue";
import { isLocale } from "../i18n/dict";
import { audit } from "./audit";
import { cancelResourceBooking, createResourceBooking, ResourceError } from "./resources";

/**
 * Angebote (SPEC 19.21): Anfrage → Angebot → Annahme per Link → Raumbuchung.
 * Jede Abfrage nach hotel_id; der öffentliche Zugriff nur über das Token.
 */
export class OfferError extends Error {}

const KIND_TITLE: Record<string, string> = { seminar: "Seminar / Tagung", group: "Gruppe", wedding: "Hochzeit / Fest", company: "Firmenanlass", other: "Anlass", table: "Tischreservation" };
const DEFAULT_VALID_DAYS = 14;

export const lineSchema = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(10_000),
  unitRappen: z.number().int().min(-10_000_000).max(10_000_000),
  vatKind: z.enum(["stay", "standard", "none"]).default("standard"),
  resourceId: z.string().uuid().nullable().default(null),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  start: z.string().nullable().default(null),
  end: z.string().nullable().default(null),
  persons: z.number().int().min(1).max(2000).nullable().default(null),
});
export const offerSchema = z.object({
  title: z.string().trim().min(1).max(160),
  intro: z.string().trim().max(4000).default(""),
  company: z.string().trim().max(160).default(""),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(lineSchema).max(60),
});
export type OfferInput = z.input<typeof offerSchema>;

export async function createOfferFromInquiry(hotel: Hotel, inquiryId: string, actor: string, now = new Date()): Promise<Offer> {
  const today = todayIn(hotel.timezone, now);
  return db().transaction(async (tx) => {
    const [q] = await tx.select().from(inquiries).where(and(eq(inquiries.id, inquiryId), eq(inquiries.hotelId, hotel.id)));
    if (!q) throw new OfferError("Anfrage nicht gefunden.");
    // Nummernkreis je Betrieb: Hotelzeile sperren, damit zwei Angebote nie dieselbe Nummer bekommen
    await tx.execute(sql`SELECT id FROM hotels WHERE id = ${hotel.id} FOR UPDATE`);
    const [{ n }] = rows<{ n: number }>(await tx.execute(sql`SELECT coalesce(max(seq), 0)::int AS n FROM offers WHERE hotel_id = ${hotel.id}`)).map((r) => r);
    const [o] = await tx.insert(offers).values({
      hotelId: hotel.id, inquiryId: q.id, seq: n + 1, publicToken: newPublicToken(), customerName: q.name, customerEmail: q.email,
      title: `${KIND_TITLE[q.kind] ?? "Anlass"}${q.dateFrom ? ` ${q.dateFrom.split("-").reverse().join(".")}` : ""}`,
      language: isLocale(q.language) ? q.language : "de", validUntil: addDays(today, DEFAULT_VALID_DAYS), createdBy: actor,
    }).returning();
    await audit(tx, { hotelId: hotel.id, actor, action: "offer.create", entity: "offer", entityId: o.id, details: { inquiryId } });
    return o;
  });
}

async function resolveLines(hotelId: string, input: z.output<typeof offerSchema>["lines"]) {
  const out: Omit<OfferLine, "id" | "offerId" | "hotelId" | "resourceBookingId">[] = [];
  let pos = 0;
  for (const l of input) {
    let unit = l.unitRappen;
    let startMin: number | null = null, endMin: number | null = null;
    if (l.resourceId) {
      const [r] = await db().select().from(resources).where(and(eq(resources.id, l.resourceId), eq(resources.hotelId, hotelId)));
      if (!r) throw new OfferError("Angebot vor Ort nicht gefunden.");
      if (!l.day || !l.start || !l.end || !l.persons) throw new OfferError("Für eine Raumreservation Tag, Von, Bis und Personen angeben.");
      startMin = parseHhmm(l.start); endMin = l.end.trim() === "24:00" ? 1440 : parseHhmm(l.end);
      if (startMin === null || endMin === null || endMin <= startMin) throw new OfferError("Zeit der Raumreservation ungültig.");
      // Kein Preis eingegeben: Preis des Angebots vor Ort übernehmen
      if (unit === 0 && l.quantity === 1) unit = priceOf(r, startMin, endMin, l.persons);
    }
    out.push({ position: pos++, description: l.description, quantity: l.quantity, unitRappen: unit, vatKind: l.vatKind, resourceId: l.resourceId, day: l.resourceId ? l.day : null, startMin, endMin, persons: l.resourceId ? l.persons : null });
  }
  return out;
}

/** Entwurf speichern (nur solange nicht gesendet) */
export async function saveOffer(hotel: Hotel, id: string, input: OfferInput, actor: string): Promise<void> {
  const v = offerSchema.parse(input);
  const lines = await resolveLines(hotel.id, v.lines);
  await db().transaction(async (tx) => {
    const [o] = await tx.select().from(offers).where(and(eq(offers.id, id), eq(offers.hotelId, hotel.id))).for("update");
    if (!o) throw new OfferError("Angebot nicht gefunden.");
    if (o.status !== "draft") throw new OfferError("Ein gesendetes Angebot lässt sich nicht mehr ändern. Erstellen Sie ein neues.");
    await tx.update(offers).set({ title: v.title, intro: v.intro, company: v.company, validUntil: v.validUntil }).where(eq(offers.id, id));
    await tx.delete(offerLines).where(and(eq(offerLines.offerId, id), eq(offerLines.hotelId, hotel.id)));
    if (lines.length) await tx.insert(offerLines).values(lines.map((l) => ({ ...l, offerId: id, hotelId: hotel.id })));
    await audit(tx, { hotelId: hotel.id, actor, action: "offer.save", entity: "offer", entityId: id, details: { lines: lines.length } });
  });
}

export async function offerWithLines(hotelId: string, id: string) {
  const [o] = await db().select().from(offers).where(and(eq(offers.id, id), eq(offers.hotelId, hotelId)));
  if (!o) return null;
  const lines = await db().select().from(offerLines).where(and(eq(offerLines.offerId, id), eq(offerLines.hotelId, hotelId))).orderBy(asc(offerLines.position));
  return { offer: o, lines };
}

export async function listOffers(hotelId: string): Promise<Offer[]> {
  return db().select().from(offers).where(eq(offers.hotelId, hotelId)).orderBy(desc(offers.createdAt)).limit(200);
}

export async function sendOffer(hotel: Hotel, id: string, actor: string, now = new Date()): Promise<void> {
  const today = todayIn(hotel.timezone, now);
  await db().transaction(async (tx) => {
    const [o] = await tx.select().from(offers).where(and(eq(offers.id, id), eq(offers.hotelId, hotel.id))).for("update");
    if (!o) throw new OfferError("Angebot nicht gefunden.");
    if (o.status !== "draft") throw new OfferError("Das Angebot wurde schon gesendet.");
    const lines = await tx.select().from(offerLines).where(and(eq(offerLines.offerId, id), eq(offerLines.hotelId, hotel.id)));
    if (!lines.length) throw new OfferError("Fügen Sie mindestens eine Position hinzu.");
    if (o.validUntil < today) throw new OfferError("Die Gültigkeit liegt in der Vergangenheit.");
    await tx.update(offers).set({ status: "sent", sentAt: now }).where(eq(offers.id, id));
    await enqueueEmail(tx, { hotelId: hotel.id, template: "offer_sent", to: o.customerEmail, language: o.language, data: { offerId: id, token: o.publicToken, name: o.customerName, title: o.title, validUntil: o.validUntil, intro: o.intro } });
    await audit(tx, { hotelId: hotel.id, actor, action: "offer.send", entity: "offer", entityId: id, details: { to: o.customerEmail } });
  });
}

export async function offerByToken(token: string) {
  const [o] = await db().select().from(offers).where(eq(offers.publicToken, token));
  if (!o || o.status === "draft") return null;
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, o.hotelId));
  const lines = await db().select().from(offerLines).where(and(eq(offerLines.offerId, o.id), eq(offerLines.hotelId, o.hotelId))).orderBy(asc(offerLines.position));
  return { offer: o, lines, hotel };
}

/**
 * Annahme durch den Kunden. Reservationen der Raumzeilen entstehen jetzt; ist eine nicht mehr frei, wird alles zurückgenommen
 * und das Angebot bleibt offen (Hotel meldet sich).
 */
export async function acceptOffer(token: string, note: string, now = new Date()): Promise<void> {
  const d = await offerByToken(token);
  if (!d) throw new OfferError("Angebot nicht gefunden.");
  const { offer, lines, hotel } = d;
  if (!offerOpen(offer, todayIn(hotel.timezone, now))) throw new OfferError(offer.status === "accepted" ? "Das Angebot wurde schon angenommen." : "Dieses Angebot ist nicht mehr gültig. Bitte melden Sie sich beim Hotel.");
  const created: { lineId: string; rbId: string }[] = [];
  const guestName = offer.company ? `${offer.company} (${offer.customerName})` : offer.customerName;
  try {
    for (const l of lines) {
      if (!l.resourceId || !l.day || l.startMin === null || l.endMin === null || !l.persons) continue;
      const rb = await createResourceBooking(hotel.id, { resourceId: l.resourceId, day: l.day, start: hhmm(l.startMin), end: l.endMin === 1440 ? "24:00" : hhmm(l.endMin), persons: l.persons, guestName, note: `Angebot ${offer.seq}` }, `offer:${offer.id}`);
      created.push({ lineId: l.id, rbId: rb.id });
    }
  } catch (e) {
    for (const c of created) await cancelResourceBooking(hotel.id, c.rbId, "offer:rollback").catch(() => undefined);
    if (e instanceof ResourceError) throw new OfferError(`Ein Termin ist leider nicht mehr frei (${e.message}). Das Hotel meldet sich bei Ihnen.`);
    throw e;
  }
  await db().transaction(async (tx) => {
    const [cur] = await tx.select().from(offers).where(eq(offers.id, offer.id)).for("update");
    if (cur.status !== "sent") throw new OfferError("Das Angebot wurde schon beantwortet.");
    await tx.update(offers).set({ status: "accepted", decidedAt: now, decisionNote: note.trim().slice(0, 1000) }).where(eq(offers.id, offer.id));
    for (const c of created) await tx.update(offerLines).set({ resourceBookingId: c.rbId }).where(eq(offerLines.id, c.lineId));
    if (offer.inquiryId) await tx.update(inquiries).set({ status: "done" }).where(and(eq(inquiries.id, offer.inquiryId), eq(inquiries.hotelId, hotel.id)));
    await enqueueEmail(tx, { hotelId: hotel.id, template: "offer_accepted", to: hotel.contactEmail, language: hotel.defaultLanguage, data: { offerId: offer.id, seq: offer.seq, name: offer.customerName, email: offer.customerEmail, title: offer.title, note: note.trim().slice(0, 1000), reservations: created.length } });
    await audit(tx, { hotelId: hotel.id, actor: "guest", action: "offer.accept", entity: "offer", entityId: offer.id, details: { reservations: created.length } });
  });
}

export async function declineOffer(token: string, note: string, now = new Date()): Promise<void> {
  const d = await offerByToken(token);
  if (!d) throw new OfferError("Angebot nicht gefunden.");
  const { offer, hotel } = d;
  if (offer.status !== "sent") throw new OfferError("Das Angebot ist nicht mehr offen.");
  await db().transaction(async (tx) => {
    await tx.update(offers).set({ status: "declined", decidedAt: now, decisionNote: note.trim().slice(0, 1000) }).where(and(eq(offers.id, offer.id), eq(offers.status, "sent")));
    await enqueueEmail(tx, { hotelId: hotel.id, template: "offer_declined", to: hotel.contactEmail, language: hotel.defaultLanguage, data: { offerId: offer.id, seq: offer.seq, name: offer.customerName, title: offer.title, note: note.trim().slice(0, 1000) } });
    await audit(tx, { hotelId: hotel.id, actor: "guest", action: "offer.decline", entity: "offer", entityId: offer.id, details: {} });
  });
}
