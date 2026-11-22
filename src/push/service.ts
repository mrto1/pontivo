import webpush from "web-push";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, type Executor } from "../db/client";
import { bookings, hotelMembers, pushOutbox, pushPrefs, pushSubscriptions } from "../db/schema";
import { visibleNav } from "../admin/visible-nav";
import { hiddenNavKeys } from "../domain/modules";
import { pushWanted, type PushKind } from "../domain/push-kinds";
import { groupPushes } from "../domain/push-group";
import type { Role } from "../domain/roles";
import { getHotelById } from "../services/hotels";
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
export async function enqueuePush(ex: Executor, hotelId: string, dedupeKey: string, p: Omit<PushPayload, "tag"> & { kind?: PushKind }) {
  if (!p.url.startsWith("/admin/")) throw new Error("Push-Link muss auf /admin/ zeigen");
  await ex.insert(pushOutbox).values({ hotelId, dedupeKey, title: p.title, body: p.body.slice(0, 200), url: p.url, kind: p.kind ?? "other" }).onConflictDoNothing();
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
  await enqueuePush(ex, hotelId, `booking_${kind}:${bookingId}`, { ...text, url: `/admin/${hotelId}/bookings/${bookingId}`, kind: "bookings" });
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

/** Fällige Mitteilungen an die Geräte der berechtigten Personen des Hotels senden. Abgemeldete Geräte (404/410) werden gelöscht. */
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
  const navCache = new Map<string, ReturnType<typeof visibleNav>["navs"] | null>();
  // Gleichartige Meldungen desselben Betriebs im selben Lauf werden zu einer Sammelmeldung (src/domain/push-group.ts)
  for (const r of groupPushes(rows)) {
    // Nur Geräte von Personen, die Mitglied sind, die Art sehen dürfen und sie nicht abgestellt haben (SPEC 20.1)
    const all = await db()
      .select({ s: pushSubscriptions, role: hotelMembers.role })
      .from(pushSubscriptions)
      .innerJoin(hotelMembers, and(eq(hotelMembers.hotelId, pushSubscriptions.hotelId), eq(hotelMembers.userId, pushSubscriptions.userId)))
      .where(eq(pushSubscriptions.hotelId, r.hotelId));
    const prefs = new Map((await db().select().from(pushPrefs).where(and(eq(pushPrefs.hotelId, r.hotelId), eq(pushPrefs.kind, r.kind)))).map((x) => [x.userId, x.enabled]));
    const subs: (typeof pushSubscriptions.$inferSelect)[] = [];
    for (const x of all) {
      const key = `${r.hotelId}:${x.role}`;
      if (!navCache.has(key)) {
        // Lazy: services/modules zieht next/navigation, das die Playwright-Tests nicht laden können
        const { moduleRows } = await import("../services/modules");
        const h = await getHotelById(r.hotelId);
        navCache.set(key, h ? visibleNav(h, x.role as Role, hiddenNavKeys(await moduleRows(h.id))).navs : null);
      }
      const navs = navCache.get(key);
      if (navs && pushWanted(x.role as Role, r.kind, navs, prefs.get(x.s.userId))) subs.push(x.s);
    }
    if (!subs.length) {
      await db().update(pushOutbox).set({ status: "cancelled" }).where(inArray(pushOutbox.id, r.ids));
      continue;
    }
    let delivered = 0;
    let transient = 0;
    for (const s of subs) {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, { title: r.title, body: r.body, url: r.url, tag: r.tag });
        delivered++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db().delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, s.id), eq(pushSubscriptions.hotelId, r.hotelId)));
        else transient++;
      }
    }
    if (delivered > 0 || transient === 0) {
      await db().update(pushOutbox).set({ status: delivered > 0 ? "sent" : "cancelled", sentAt: new Date(), attempts: r.attempts + 1 }).where(inArray(pushOutbox.id, r.ids));
      if (delivered > 0) sent++;
    } else {
      const attempts = r.attempts + 1;
      await db().update(pushOutbox).set({ attempts, status: attempts >= MAX_ATTEMPTS ? "failed" : "pending" }).where(inArray(pushOutbox.id, r.ids));
      if (attempts >= MAX_ATTEMPTS) failed++;
    }
  }
  await db().delete(pushOutbox).where(and(inArray(pushOutbox.status, ["sent", "cancelled", "failed"]), lt(pushOutbox.createdAt, sql`now() - interval '7 days'`)));
  return { sent, failed };
}

// ---------------------------------------------------------------- Einstellungen je Person (SPEC 20.1)

export async function getPushPrefs(hotelId: string, userId: string): Promise<Partial<Record<PushKind, boolean>>> {
  const r = await db().select().from(pushPrefs).where(and(eq(pushPrefs.hotelId, hotelId), eq(pushPrefs.userId, userId)));
  return Object.fromEntries(r.map((x) => [x.kind, x.enabled]));
}

/** Speichert die Wahl für die genannten Arten (nur diese Person, nur dieser Betrieb) */
export async function savePushPrefs(hotelId: string, userId: string, prefs: Partial<Record<PushKind, boolean>>) {
  for (const [kind, enabled] of Object.entries(prefs) as [PushKind, boolean][]) {
    await db().insert(pushPrefs).values({ hotelId, userId, kind, enabled }).onConflictDoUpdate({ target: [pushPrefs.userId, pushPrefs.hotelId, pushPrefs.kind], set: { enabled } });
  }
}
