import webpush from "web-push";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, type Executor } from "../db/client";
import { bookings, pushOutbox, pushSubscriptions } from "../db/schema";
import { env } from "../env";

/**
 * Push-Mitteilungen für den Admin (Web Push mit VAPID). Ereignisse landen in derselben Transaktion in `push_outbox`
 * (wie E-Mails), der Worker verschickt sie an die Geräte der Mitarbeitenden dieses Hotels.
 * Der Inhalt enthält keine Gästenamen (Mitteilungen erscheinen auf dem Sperrbildschirm).
 */
export function pushConfigured(): boolean {
  const e = env();
  return !!(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY);
}
export const vapidPublicKey = () => env().VAPID_PUBLIC_KEY ?? null;

export type PushPayload = { title: string; body: string; url: string; tag?: string };
export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushSender = (target: PushTarget, payload: PushPayload) => Promise<void>;

let sender: PushSender | null = null;
/** Für Tests */
export function setPushSender(fn: PushSender | null) {
  sender = fn;
}

const realSender: PushSender = async (target, payload) => {
  const e = env();
  await webpush.sendNotification(target, JSON.stringify(payload), {
    TTL: 3600,
    urgency: "high",
    vapidDetails: { subject: e.VAPID_SUBJECT ?? `mailto:${e.PLATFORM_ALERT_EMAIL ?? "info@pontivo.ch"}`, publicKey: e.VAPID_PUBLIC_KEY!, privateKey: e.VAPID_PRIVATE_KEY! },
  });
};

/** Mitteilung einreihen (in der Transaktion des Ereignisses). Pro Hotel und Ereignis nur einmal. */
export async function enqueuePush(ex: Executor, hotelId: string, dedupeKey: string, p: Omit<PushPayload, "tag">) {
  if (!p.url.startsWith("/admin/")) throw new Error("Push-Link muss auf /admin/ zeigen");
  await ex.insert(pushOutbox).values({ hotelId, dedupeKey, title: p.title, body: p.body.slice(0, 200), url: p.url }).onConflictDoNothing();
}

export type BookingPushKind = "new" | "cancelled" | "overbooking";

/** Mitteilung zu einer Buchung: nur Referenz, Anreise und Quelle (keine Personendaten) */
export async function pushForBooking(ex: Executor, hotelId: string, bookingId: string, kind: BookingPushKind) {
  const [b] = await ex.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)));
  if (!b) return;
  const what = `${b.reference} · Anreise ${b.checkin}`;
  const text = {
    new: { title: "Neue Buchung", body: `${what} · ${b.source}` },
    cancelled: { title: "Buchung storniert", body: what },
    overbooking: { title: "Überbuchung – bitte sofort prüfen", body: what },
  }[kind];
  await enqueuePush(ex, hotelId, `booking_${kind}:${bookingId}`, { ...text, url: `/admin/${hotelId}/bookings/${bookingId}` });
}

// ---------------------------------------------------------------- Geräte

export type SubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

function validSubscription(s: SubscriptionInput) {
  let ok = false;
  try {
    ok = new URL(s.endpoint).protocol === "https:";
  } catch {
    ok = false;
  }
  if (!ok || !s.keys?.p256dh || !s.keys?.auth || s.endpoint.length > 2000) throw new Error("Ungültiges Gerät für Mitteilungen");
}

export async function saveSubscription(hotelId: string, userId: string, s: SubscriptionInput, userAgent: string | null) {
  validSubscription(s);
  await db()
    .insert(pushSubscriptions)
    .values({ hotelId, userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null })
    .onConflictDoUpdate({
      target: [pushSubscriptions.hotelId, pushSubscriptions.endpoint],
      set: { userId, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null },
    });
}

/** Nur das eigene Gerät dieses Benutzers in diesem Hotel */
export async function removeSubscription(hotelId: string, userId: string, endpoint: string) {
  await db().delete(pushSubscriptions).where(and(eq(pushSubscriptions.hotelId, hotelId), eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function hasSubscription(hotelId: string, userId: string, endpoint: string): Promise<boolean> {
  const rows = await db().select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(and(eq(pushSubscriptions.hotelId, hotelId), eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
  return rows.length > 0;
}

// ---------------------------------------------------------------- Versand (Worker)

const MAX_ATTEMPTS = 3;

/** Fällige Mitteilungen an alle Geräte des Hotels senden. Abgemeldete Geräte (404/410) werden gelöscht. */
export async function sendDuePushes(): Promise<{ sent: number; failed: number }> {
  const rows = await db().select().from(pushOutbox).where(eq(pushOutbox.status, "pending")).orderBy(pushOutbox.id).limit(50);
  let sent = 0;
  let failed = 0;
  if (rows.length && !pushConfigured() && !sender) {
    // Ohne Schlüssel gibt es keine Geräte; Einträge nicht liegen lassen
    await db().update(pushOutbox).set({ status: "cancelled" }).where(inArray(pushOutbox.id, rows.map((r) => r.id)));
    return { sent, failed };
  }
  const send = sender ?? realSender;
  for (const r of rows) {
    const subs = await db().select().from(pushSubscriptions).where(eq(pushSubscriptions.hotelId, r.hotelId));
    if (!subs.length) {
      await db().update(pushOutbox).set({ status: "cancelled" }).where(eq(pushOutbox.id, r.id));
      continue;
    }
    let delivered = 0;
    let transient = 0;
    for (const s of subs) {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, { title: r.title, body: r.body, url: r.url, tag: r.dedupeKey });
        delivered++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db().delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, s.id), eq(pushSubscriptions.hotelId, r.hotelId)));
        else transient++;
      }
    }
    if (delivered > 0 || transient === 0) {
      await db().update(pushOutbox).set({ status: delivered > 0 ? "sent" : "cancelled", sentAt: new Date(), attempts: r.attempts + 1 }).where(eq(pushOutbox.id, r.id));
      if (delivered > 0) sent++;
    } else {
      const attempts = r.attempts + 1;
      await db().update(pushOutbox).set({ attempts, status: attempts >= MAX_ATTEMPTS ? "failed" : "pending" }).where(eq(pushOutbox.id, r.id));
      if (attempts >= MAX_ATTEMPTS) failed++;
    }
  }
  await db().delete(pushOutbox).where(and(inArray(pushOutbox.status, ["sent", "cancelled", "failed"]), lt(pushOutbox.createdAt, sql`now() - interval '7 days'`)));
  return { sent, failed };
}
