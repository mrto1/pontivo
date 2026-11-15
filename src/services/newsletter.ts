import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { bookings, guestProfiles, guests, newsletters, type Hotel, type Newsletter, type NewsletterSegment } from "../db/schema";
import { enqueueEmail } from "../email/enqueue";
import { env, requireEnv } from "../env";
import { normEmail, select, validEmail, type Recipient } from "../domain/newsletter";
import { audit } from "./audit";

/** Newsletter (SPEC 19.12): nur Gäste mit Einwilligung; Abmeldung widerruft sie für alle Gästeeinträge dieser E-Mail im Betrieb. */
export class NewsletterError extends Error {}

export const unsubscribeToken = (hotelId: string, email: string) =>
  crypto.createHmac("sha256", requireEnv("AUTH_SECRET")).update(`unsub:${hotelId}:${normEmail(email)}`).digest("base64url");
export const unsubscribeUrl = (hotelId: string, email: string) =>
  `${env().APP_BASE_URL}/abmelden?h=${hotelId}&e=${encodeURIComponent(normEmail(email))}&t=${unsubscribeToken(hotelId, email)}`;

/** Alle Gäste mit Einwilligung (eine Zeile je E-Mail), mit Stichwörtern und Aufenthalten */
export async function consentedGuests(hotelId: string): Promise<Recipient[]> {
  const gs = await db().select({ id: guests.id, email: guests.email, language: guests.language, createdAt: guests.createdAt }).from(guests)
    .where(and(eq(guests.hotelId, hotelId), eq(guests.marketingConsent, true))).orderBy(desc(guests.createdAt));
  const stays = await db().select({ guestId: bookings.guestId, n: sql<number>`count(*)`, last: sql<string>`max(${bookings.checkout})` }).from(bookings)
    .where(and(eq(bookings.hotelId, hotelId), eq(bookings.status, "confirmed"))).groupBy(bookings.guestId);
  const profiles = await db().select({ email: guestProfiles.email, tags: guestProfiles.tags }).from(guestProfiles).where(eq(guestProfiles.hotelId, hotelId));
  const tagsOf = new Map(profiles.map((p) => [normEmail(p.email), p.tags.map((t) => t.toLowerCase())]));
  const stayOf = new Map(stays.filter((s) => s.guestId).map((s) => [s.guestId as string, s]));
  const byEmail = new Map<string, Recipient>();
  for (const g of gs) {
    const email = normEmail(g.email);
    if (!validEmail(email)) continue;
    const st = stayOf.get(g.id);
    const cur = byEmail.get(email);
    if (!cur) byEmail.set(email, { email, language: g.language, tags: tagsOf.get(email) ?? [], stays: Number(st?.n ?? 0), lastStay: st?.last ?? null });
    else {
      cur.stays += Number(st?.n ?? 0);
      if (st?.last && (!cur.lastStay || st.last > cur.lastStay)) cur.lastStay = st.last;
    }
  }
  return [...byEmail.values()];
}

export async function previewRecipients(hotelId: string, seg: NewsletterSegment) {
  return select(await consentedGuests(hotelId), seg);
}

const cleanSegment = (s: NewsletterSegment): NewsletterSegment => ({
  ...(s.language ? { language: s.language } : {}),
  ...(s.tag?.trim() ? { tag: s.tag.trim().toLowerCase().slice(0, 40) } : {}),
  ...(s.stayedSince && /^\d{4}-\d{2}-\d{2}$/.test(s.stayedSince) ? { stayedSince: s.stayedSince } : {}),
  ...(s.minStays && s.minStays > 0 ? { minStays: Math.min(99, Math.floor(s.minStays)) } : {}),
});

export async function saveDraft(hotelId: string, id: string | null, input: { subject: string; body: string; segment: NewsletterSegment }, actor: string): Promise<Newsletter> {
  const subject = input.subject.trim().slice(0, 150), body = input.body.trim().slice(0, 10000);
  if (!subject) throw new NewsletterError("Der Betreff fehlt.");
  if (!body) throw new NewsletterError("Der Text fehlt.");
  const v = { subject, body, segment: cleanSegment(input.segment) };
  return db().transaction(async (tx) => {
    let n: Newsletter;
    if (id) {
      [n] = await tx.update(newsletters).set(v).where(and(eq(newsletters.id, id), eq(newsletters.hotelId, hotelId), eq(newsletters.status, "draft"))).returning();
      if (!n) throw new NewsletterError("Entwurf nicht gefunden (oder schon versendet).");
    } else {
      [n] = await tx.insert(newsletters).values({ ...v, hotelId, createdBy: actor }).returning();
    }
    await audit(tx, { hotelId, actor, action: id ? "newsletter.update" : "newsletter.create", entity: "newsletter", entityId: n.id });
    return n;
  });
}

export const listNewsletters = (hotelId: string) => db().select().from(newsletters).where(eq(newsletters.hotelId, hotelId)).orderBy(desc(newsletters.createdAt)).limit(50);

/** Testmail an eine einzelne Adresse (ohne Einwilligungsprüfung, nur Vorschau) */
export async function sendTest(hotel: Hotel, id: string, to: string, actor: string) {
  const [n] = await db().select().from(newsletters).where(and(eq(newsletters.id, id), eq(newsletters.hotelId, hotel.id)));
  if (!n) throw new NewsletterError("Entwurf nicht gefunden.");
  const email = normEmail(to);
  if (!validEmail(email)) throw new NewsletterError("Die E-Mail-Adresse ist ungültig.");
  await db().transaction(async (tx) => {
    await enqueueEmail(tx, { hotelId: hotel.id, template: "newsletter", to: email, language: hotel.defaultLanguage, data: { subject: `[Test] ${n.subject}`, body: n.body, unsubscribeUrl: unsubscribeUrl(hotel.id, email) } });
    await audit(tx, { hotelId: hotel.id, actor, action: "newsletter.test", entity: "newsletter", entityId: n.id });
  });
}

/** Versand: Empfänger zum Zeitpunkt des Versands, einmalig (Status wechselt atomar von draft auf sent) */
export async function sendNewsletter(hotel: Hotel, id: string, actor: string): Promise<number> {
  return db().transaction(async (tx) => {
    const [n] = await tx.update(newsletters).set({ status: "sent", sentAt: new Date() }).where(and(eq(newsletters.id, id), eq(newsletters.hotelId, hotel.id), eq(newsletters.status, "draft"))).returning();
    if (!n) throw new NewsletterError("Entwurf nicht gefunden oder schon versendet.");
    const to = select(await consentedGuests(hotel.id), n.segment);
    if (!to.length) throw new NewsletterError("Kein Gast mit Einwilligung entspricht der Auswahl.");
    for (const r of to) {
      await enqueueEmail(tx, { hotelId: hotel.id, template: "newsletter", to: r.email, language: r.language, data: { subject: n.subject, body: n.body, unsubscribeUrl: unsubscribeUrl(hotel.id, r.email) } });
    }
    await tx.update(newsletters).set({ recipients: to.length }).where(eq(newsletters.id, n.id));
    await audit(tx, { hotelId: hotel.id, actor, action: "newsletter.send", entity: "newsletter", entityId: n.id, details: { recipients: to.length } });
    return to.length;
  });
}

/** Abmeldung über den Link: Einwilligung für diese E-Mail im Betrieb widerrufen. false bei ungültigem Link. */
export async function unsubscribe(hotelId: string, email: string, token: string): Promise<boolean> {
  const expected = Buffer.from(unsubscribeToken(hotelId, email));
  const given = Buffer.from(token);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
  await db().transaction(async (tx) => {
    await tx.update(guests).set({ marketingConsent: false }).where(and(eq(guests.hotelId, hotelId), sql`lower(${guests.email}) = ${normEmail(email)}`));
    await audit(tx, { hotelId, actor: "guest", action: "newsletter.unsubscribe", details: {} });
  });
  return true;
}
