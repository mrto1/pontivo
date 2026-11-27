import { UserError } from "../domain/errors";
import { and, avg, count, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { bookings, guests, hotels, stayFeedback, type Hotel, type StayFeedback } from "../db/schema";
import { enqueueEmail } from "../email/enqueue";
import { audit } from "./audit";

/**
 * Bewertungen einholen (SPEC 19.2): Nach dem Aufenthalt gibt der Gast eine Note von 1 bis 5. Ab der Mindestnote bekommt er den Link
 * zur öffentlichen Bewertungsseite des Hauses, darunter geht die Rückmeldung nur intern ans Haus (Mail). Eine Rückmeldung pro Buchung. Der Link steht in der Nachher-Mail (gleiche Einwilligung wie dort).
 */
export class FeedbackError extends UserError {}

export const DEFAULT_MIN_SCORE = 4;
export const feedbackSettings = (hotel: Pick<Hotel, "content">) => ({ reviewUrl: hotel.content?.feedback?.reviewUrl ?? "", minScore: hotel.content?.feedback?.minScore ?? DEFAULT_MIN_SCORE });

export async function saveFeedbackSettings(hotel: Hotel, input: { reviewUrl: string; minScore: number }, actor: string): Promise<void> {
  const url = input.reviewUrl.trim();
  if (url) {
    let u: URL;
    try { u = new URL(url); } catch { throw new FeedbackError("Der Link ist keine gültige Adresse."); }
    if (u.protocol !== "https:") throw new FeedbackError("Der Link muss mit https:// beginnen.");
  }
  if (!Number.isInteger(input.minScore) || input.minScore < 2 || input.minScore > 5) throw new FeedbackError("Die Mindestnote liegt zwischen 2 und 5.");
  await db().transaction(async (tx) => {
    const [h] = await tx.select().from(hotels).where(eq(hotels.id, hotel.id)).for("update");
    await tx.update(hotels).set({ content: { ...h.content, feedback: { reviewUrl: url, minScore: input.minScore } }, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
    await audit(tx, { hotelId: hotel.id, actor, action: "feedback.settings", entity: "hotel", entityId: hotel.id, details: { hasUrl: !!url, minScore: input.minScore } });
  });
}

export type SubmitResult = { outcome: "public"; reviewUrl: string } | { outcome: "internal" } | { outcome: "already" };

/** Rückmeldung des Gastes (Buchungslink). Nur einmal pro Buchung. */
export async function submitFeedback(token: string, scoreRaw: number, commentRaw: string, now = new Date()): Promise<SubmitResult> {
  const score = Number(scoreRaw);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new FeedbackError("invalid_score");
  const comment = commentRaw.trim().slice(0, 2000);
  const [b] = await db().select().from(bookings).where(eq(bookings.publicToken, token));
  if (!b || b.status !== "confirmed") throw new FeedbackError("not_found");
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, b.hotelId));
  const set = feedbackSettings(hotel);
  const showPublic = score >= set.minScore && !!set.reviewUrl;
  const inserted = await db().insert(stayFeedback).values({ hotelId: hotel.id, bookingId: b.id, score, comment, publicLinkShown: showPublic, createdAt: now }).onConflictDoNothing().returning();
  if (!inserted.length) return { outcome: "already" };
  if (score < set.minScore || !set.reviewUrl) {
    // Intern: Mail ans Haus, damit eine schlechte Erfahrung nicht öffentlich landet, bevor das Haus reagieren konnte
    if (score < set.minScore) await enqueueEmail(db(), { hotelId: hotel.id, bookingId: b.id, template: "feedback_alert", to: hotel.contactEmail, language: hotel.defaultLanguage, data: { score, comment } });
  }
  return showPublic ? { outcome: "public", reviewUrl: set.reviewUrl } : { outcome: "internal" };
}

export async function listFeedback(hotelId: string, limit = 200): Promise<(StayFeedback & { reference: string; guestName: string })[]> {
  const r = await db().select({ f: stayFeedback, reference: bookings.reference, first: guests.firstName, last: guests.lastName })
    .from(stayFeedback).innerJoin(bookings, eq(bookings.id, stayFeedback.bookingId)).leftJoin(guests, eq(guests.id, bookings.guestId))
    .where(eq(stayFeedback.hotelId, hotelId)).orderBy(desc(stayFeedback.createdAt)).limit(limit);
  return r.map((x) => ({ ...x.f, reference: x.reference, guestName: [x.first, x.last].filter(Boolean).join(" ") }));
}

export async function feedbackSummary(hotelId: string): Promise<{ n: number; average: number | null }> {
  const [r] = await db().select({ n: count(), a: avg(stayFeedback.score) }).from(stayFeedback).where(and(eq(stayFeedback.hotelId, hotelId)));
  return { n: Number(r.n), average: r.a === null ? null : Math.round(Number(r.a) * 10) / 10 };
}
