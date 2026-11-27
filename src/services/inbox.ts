import { UserError } from "../domain/errors";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { auditLog, bookings, hotels, inboxMessages, inboxThreads } from "../db/schema";
import { parseMessageWebhook, preview, type IncomingMessage } from "../domain/inbox";
import { channex } from "../integrations/channex/client";
import { enqueuePush } from "../push/service";

/**
 * Posteingang (SPEC 19.9). Nachrichten kommen per Channex-Webhook (Ereignis «message»); Antworten gehen über die Channex-Messages-API.
 * Der Betrieb wird über property_id ↔ hotels.channex_property_id bestimmt, jede Abfrage filtert nach hotel_id.
 */
export class InboxError extends UserError {}

/** Eingehende Webhook-Nachricht speichern. Idempotent je (Thread, Nachrichten-Id). Gibt false zurück, wenn ignoriert. */
export async function ingestWebhook(body: unknown): Promise<boolean> {
  const m = parseMessageWebhook(body);
  return m ? ingestMessage(m) : false;
}

export async function ingestMessage(m: IncomingMessage): Promise<boolean> {
  const [hotel] = await db().select({ id: hotels.id }).from(hotels).where(eq(hotels.channexPropertyId, m.propertyId));
  if (!hotel) return false;
  return db().transaction(async (tx) => {
    let bookingId: string | null = null;
    if (m.channexBookingId) {
      const [b] = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.hotelId, hotel.id), eq(bookings.channexBookingId, m.channexBookingId)));
      bookingId = b?.id ?? null;
    }
    const [existing] = await tx.select().from(inboxThreads).where(eq(inboxThreads.channexThreadId, m.threadId));
    if (existing && existing.hotelId !== hotel.id) return false; // fremder Thread: nie überschreiben
    let thread = existing;
    if (!thread) {
      [thread] = await tx.insert(inboxThreads).values({ hotelId: hotel.id, channexThreadId: m.threadId, bookingId, provider: m.provider }).onConflictDoNothing().returning();
      if (!thread) return false;
    } else if (bookingId && !thread.bookingId) {
      await tx.update(inboxThreads).set({ bookingId }).where(eq(inboxThreads.id, thread.id));
    }
    if (m.event === "message_thread_booking_assigned" || !m.messageId) return true;
    const ins = await tx.insert(inboxMessages).values({ hotelId: hotel.id, threadId: thread.id, channexMessageId: m.messageId, sender: m.sender, body: m.text, attachments: m.attachments })
      .onConflictDoNothing().returning({ id: inboxMessages.id });
    if (!ins.length) return true; // schon bekannt
    await tx.update(inboxThreads).set({
      lastMessage: preview(m.text) || (m.attachments.length ? "(Anhang)" : ""),
      lastMessageAt: new Date(),
      isClosed: false,
      unread: m.sender === "guest" ? sql`${inboxThreads.unread} + 1` : inboxThreads.unread,
      provider: m.provider || thread.provider,
    }).where(eq(inboxThreads.id, thread.id));
    if (m.sender === "guest") {
      // Mitteilung ohne Personendaten und ohne Nachrichtentext
      await enqueuePush(tx, hotel.id, `inbox:${m.threadId}:${m.messageId}`, { title: "Neue Gästenachricht", body: m.provider || "Portal", url: `/admin/${hotel.id}/inbox?thread=${thread.id}`, kind: "inbox" });
    }
    return true;
  });
}

export async function listThreads(hotelId: string, opts: { closed?: boolean } = {}) {
  return db().select({ t: inboxThreads, reference: bookings.reference }).from(inboxThreads)
    .leftJoin(bookings, eq(bookings.id, inboxThreads.bookingId))
    .where(and(eq(inboxThreads.hotelId, hotelId), eq(inboxThreads.isClosed, !!opts.closed)))
    .orderBy(desc(inboxThreads.lastMessageAt)).limit(100);
}

export async function unreadCount(hotelId: string): Promise<number> {
  const [r] = await db().select({ n: sql<number>`coalesce(sum(${inboxThreads.unread}), 0)` }).from(inboxThreads).where(and(eq(inboxThreads.hotelId, hotelId), eq(inboxThreads.isClosed, false)));
  return Number(r?.n ?? 0);
}

/** Thread lesen und als gelesen markieren */
export async function openThread(hotelId: string, threadId: string) {
  const [t] = await db().select().from(inboxThreads).where(and(eq(inboxThreads.id, threadId), eq(inboxThreads.hotelId, hotelId)));
  if (!t) return null;
  if (t.unread) await db().update(inboxThreads).set({ unread: 0 }).where(eq(inboxThreads.id, t.id));
  const messages = await db().select().from(inboxMessages).where(and(eq(inboxMessages.threadId, t.id), eq(inboxMessages.hotelId, hotelId))).orderBy(inboxMessages.createdAt);
  const [b] = t.bookingId ? await db().select({ id: bookings.id, reference: bookings.reference }).from(bookings).where(and(eq(bookings.id, t.bookingId), eq(bookings.hotelId, hotelId))) : [];
  return { thread: { ...t, unread: 0 }, messages, booking: b ?? null };
}

/** Antwort an den Gast senden (über Channex) und speichern */
export async function replyToThread(hotelId: string, threadId: string, text: string, actor: string) {
  const body = text.trim();
  if (!body) throw new InboxError("Bitte eine Nachricht eingeben.");
  if (body.length > 5000) throw new InboxError("Die Nachricht ist zu lang (höchstens 5000 Zeichen).");
  const [t] = await db().select().from(inboxThreads).where(and(eq(inboxThreads.id, threadId), eq(inboxThreads.hotelId, hotelId)));
  if (!t) throw new InboxError("Unterhaltung nicht gefunden.");
  let sent: { data?: { id?: string } };
  try {
    sent = await channex.sendThreadMessage(t.channexThreadId, body);
  } catch (e) {
    throw new InboxError(`Senden über Channex fehlgeschlagen: ${e instanceof Error ? e.message : "Fehler"}`);
  }
  // Ohne Id von Channex: lokale Kennung (der Webhook mit der echten Id würde sonst doppelt erscheinen, daher Id der Antwort bevorzugen)
  const mid = sent?.data?.id ?? `local-${crypto.randomUUID()}`;
  await db().transaction(async (tx) => {
    await tx.insert(inboxMessages).values({ hotelId, threadId: t.id, channexMessageId: mid, sender: "hotel", body, sentBy: actor }).onConflictDoNothing();
    await tx.update(inboxThreads).set({ lastMessage: preview(body), lastMessageAt: new Date(), unread: 0 }).where(eq(inboxThreads.id, t.id));
    await tx.insert(auditLog).values({ hotelId, actor, action: "inbox.reply", entity: "inbox_thread", entityId: t.id, details: {} });
  });
}

/** Unterhaltung abschliessen (bei Channex und lokal) */
export async function closeThread(hotelId: string, threadId: string, actor: string) {
  const [t] = await db().select().from(inboxThreads).where(and(eq(inboxThreads.id, threadId), eq(inboxThreads.hotelId, hotelId)));
  if (!t) throw new InboxError("Unterhaltung nicht gefunden.");
  try {
    await channex.closeThread(t.channexThreadId);
  } catch (e) {
    throw new InboxError(`Abschliessen bei Channex fehlgeschlagen: ${e instanceof Error ? e.message : "Fehler"}`);
  }
  await db().transaction(async (tx) => {
    await tx.update(inboxThreads).set({ isClosed: true, unread: 0 }).where(eq(inboxThreads.id, t.id));
    await tx.insert(auditLog).values({ hotelId, actor, action: "inbox.close", entity: "inbox_thread", entityId: t.id, details: {} });
  });
}
