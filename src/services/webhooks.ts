import dns from "node:dns/promises";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { db, rows, type Executor } from "../db/client";
import { hotels, webhookDeliveries, webhookEndpoints, type Booking, type Hotel, type WebhookEndpoint } from "../db/schema";
import { isPrivateIp, isWebhookEvent, MAX_ATTEMPTS, newSecret, nextAttemptAt, originOf, sign, urlProblem, WEBHOOK_EVENTS, type WebhookEvent } from "../domain/webhooks";
import { decryptField, encryptField } from "../lib/guest-crypto";
import { audit } from "./audit";

/**
 * Webhooks der Website-Schnittstelle (SPEC 19.22). Ereignisse entstehen in derselben Transaktion wie die Buchungsänderung,
 * der Versand läuft im Worker (Wiederholung mit Wartezeiten). Nutzdaten enthalten keine Gästedaten.
 */
export class WebhookError extends Error {}
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; redirect: "manual"; signal: AbortSignal }) => Promise<{ status: number }>;
export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address);

const MAX_ENDPOINTS = 5;

export async function createEndpoint(hotelId: string, url: string, events: string[], actor: string): Promise<{ secret: string; row: WebhookEndpoint }> {
  const problem = urlProblem(url.trim());
  if (problem) throw new WebhookError(problem);
  const ev = events.filter(isWebhookEvent).filter((e) => e !== "ping");
  const secret = newSecret();
  return db().transaction(async (tx) => {
    const [{ n }] = rows<{ n: number }>(await tx.execute(sql`SELECT count(*)::int AS n FROM webhook_endpoints WHERE hotel_id = ${hotelId}`));
    if (n >= MAX_ENDPOINTS) throw new WebhookError(`Höchstens ${MAX_ENDPOINTS} Webhook-Adressen.`);
    const [row] = await tx.insert(webhookEndpoints).values({ hotelId, url: url.trim(), secretEnc: encryptField(secret), events: ev.length ? ev : WEBHOOK_EVENTS.filter((e) => e !== "ping"), createdBy: actor }).returning();
    await audit(tx, { hotelId, actor, action: "webhook.create", entity: "webhook", entityId: row.id, details: { url: row.url } });
    return { secret, row };
  });
}

export const listEndpoints = (hotelId: string) => db().select().from(webhookEndpoints).where(eq(webhookEndpoints.hotelId, hotelId)).orderBy(desc(webhookEndpoints.createdAt));

export async function deleteEndpoint(hotelId: string, id: string, actor: string) {
  await db().transaction(async (tx) => {
    const r = await tx.delete(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.hotelId, hotelId))).returning({ id: webhookEndpoints.id });
    if (r.length) await audit(tx, { hotelId, actor, action: "webhook.delete", entity: "webhook", entityId: id });
  });
}

export async function recentDeliveries(hotelId: string, limit = 20) {
  return db().select().from(webhookDeliveries).where(eq(webhookDeliveries.hotelId, hotelId)).orderBy(desc(webhookDeliveries.createdAt)).limit(limit);
}

/** Nutzdaten ohne Gästedaten: nur Buchungsnummer, Status, Zeitraum, Beträge */
export const bookingPayload = (b: Pick<Booking, "reference" | "status" | "checkin" | "checkout" | "adults" | "children" | "totalRappen" | "source">) =>
  ({ reference: b.reference, status: b.status, checkin: b.checkin, checkout: b.checkout, adults: b.adults, children: b.children, total_rappen: b.totalRappen, source: b.source });

/** In der Transaktion der Buchungsänderung aufrufen */
export async function enqueueWebhook(ex: Executor, hotelId: string, event: WebhookEvent, data: Record<string, unknown>, now = new Date()) {
  const eps = await ex.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.hotelId, hotelId), eq(webhookEndpoints.active, true)));
  const targets = eps.filter((e) => e.events.includes(event));
  if (!targets.length) return;
  const eventId = crypto.randomUUID();
  await ex.insert(webhookDeliveries).values(targets.map((e) => ({ hotelId, endpointId: e.id, event, eventId, payload: { id: eventId, type: event, created_at: now.toISOString(), data }, nextAttemptAt: now })));
}

/** Testereignis an eine Adresse (Knopf im Admin) */
export async function sendPing(hotelId: string, endpointId: string, actor: string, now = new Date()) {
  const [e] = await db().select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.hotelId, hotelId)));
  if (!e) throw new WebhookError("Adresse nicht gefunden.");
  const eventId = crypto.randomUUID();
  await db().insert(webhookDeliveries).values({ hotelId, endpointId: e.id, event: "ping", eventId, payload: { id: eventId, type: "ping", created_at: now.toISOString(), data: {} }, nextAttemptAt: now });
  await audit(db(), { hotelId, actor, action: "webhook.ping", entity: "webhook", entityId: e.id });
}

/** Vor jedem Versand: Ziel muss öffentlich sein (Namen werden aufgelöst, alle Adressen geprüft) */
export async function assertPublicTarget(url: string, resolve: Resolver = defaultResolver) {
  const p = urlProblem(url);
  if (p) throw new WebhookError(p);
  const addrs = await resolve(new URL(url).hostname);
  if (!addrs.length || addrs.some(isPrivateIp)) throw new WebhookError("Ziel ist keine öffentliche Adresse.");
}

/** Fällige Zustellungen versenden. Jede Zustellung wird mit SKIP LOCKED übernommen (mehrere Worker stören sich nicht). */
export async function deliverDue(opts: { now?: Date; fetcher?: FetchLike; resolver?: Resolver; limit?: number } = {}): Promise<{ sent: number; failed: number; retry: number }> {
  const now = opts.now ?? new Date();
  const fetcher: FetchLike = opts.fetcher ?? ((u, i) => fetch(u, i));
  const out = { sent: 0, failed: 0, retry: 0 };
  const due = rows<{ id: string }>(await db().execute(sql`SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= ${now.toISOString()}::timestamptz ORDER BY next_attempt_at LIMIT ${opts.limit ?? 50}`));
  for (const { id } of due) {
    await db().transaction(async (tx) => {
      const [d] = await tx.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, now))).for("update", { skipLocked: true });
      if (!d) return;
      const [ep] = await tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, d.endpointId));
      const attempts = d.attempts + 1;
      let status: number | null = null, error: string | null = null;
      if (!ep || !ep.active) error = "Adresse nicht mehr aktiv";
      else {
        try {
          await assertPublicTarget(ep.url, opts.resolver);
          const body = JSON.stringify(d.payload);
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 8000);
          try {
            const res = await fetcher(ep.url, { method: "POST", redirect: "manual", signal: ctl.signal, body, headers: { "content-type": "application/json", "user-agent": "Pontivo-Webhooks/1", "pontivo-event": d.event, "pontivo-delivery": d.id, "pontivo-signature": sign(decryptField(ep.secretEnc)!, body, Math.floor(now.getTime() / 1000)) } });
            status = res.status;
          } finally { clearTimeout(timer); }
          if (status < 200 || status >= 300) error = `HTTP ${status}`;
        } catch (e) { error = e instanceof WebhookError ? e.message : "Nicht erreichbar"; }
      }
      if (!error) {
        await tx.update(webhookDeliveries).set({ status: "sent", attempts, lastStatus: status, lastError: null, sentAt: now }).where(eq(webhookDeliveries.id, d.id));
        out.sent++;
      } else {
        const next = !ep || !ep.active ? null : nextAttemptAt(attempts, now);
        await tx.update(webhookDeliveries).set({ attempts, lastStatus: status, lastError: error, ...(next ? { nextAttemptAt: next } : { status: "failed" as const }) }).where(eq(webhookDeliveries.id, d.id));
        if (next) out.retry++; else out.failed++;
      }
    });
  }
  return out;
}

/** Tägliche Aufräumarbeit: alte Zustellungen (30 Tage) und Idempotenz-Einträge (48 Stunden) löschen */
export async function webhookCleanup(now = new Date()): Promise<number> {
  const a = await db().execute(sql`DELETE FROM webhook_deliveries WHERE created_at < ${new Date(now.getTime() - 30 * 86_400_000).toISOString()}::timestamptz AND status <> 'pending'`);
  const b = await db().execute(sql`DELETE FROM api_idempotency WHERE created_at < ${new Date(now.getTime() - 48 * 3_600_000).toISOString()}::timestamptz`);
  return (a.rowCount ?? 0) + (b.rowCount ?? 0);
}
export { MAX_ATTEMPTS };

/** Erlaubte Rückkehr-Adressen nach der Zahlung (nur Ursprünge, https), höchstens 10 */
export async function saveReturnOrigins(hotel: Hotel, text: string, actor: string): Promise<string[]> {
  const list = [...new Set(text.split(/[\s,;]+/).filter(Boolean).map((u) => originOf(u)))];
  if (list.some((o) => o === null)) throw new WebhookError("Nur https-Adressen (z. B. https://www.beispiel.ch).");
  const origins = list as string[];
  if (origins.length > 10) throw new WebhookError("Höchstens 10 Adressen.");
  await db().update(hotels).set({ content: { ...hotel.content, api: { ...(hotel.content.api ?? {}), returnOrigins: origins } }, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
  await audit(db(), { hotelId: hotel.id, actor, action: "api.return_origins", entity: "hotel", entityId: hotel.id, details: { origins } });
  return origins;
}
