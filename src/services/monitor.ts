import { statfsSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { systemStatus } from "../db/schema";
import { enqueueEmail } from "../email/enqueue";
import { env } from "../env";

/**
 * Überwachung: Lebenszeichen des Workers, Rückstau bei E-Mail und Channex, hängende Reservierungen, Speicherplatz.
 * `checkSystem` liefert die Probleme (für /api/health?deep=1), `runWatchdog` schickt Alarm-Mails (höchstens alle 6 Stunden pro Problem).
 */

export type Problem = { name: string; detail: string };

const HEARTBEAT_MAX_MS = 5 * 60_000;
const BACKLOG_MS = 30 * 60_000;
const REALERT_MS = 6 * 3600_000;
export const MIN_FREE_DISK = 0.1;

/** Der Worker ruft das jede Minute auf */
export async function beat(now = new Date()) {
  await db().insert(systemStatus).values({ key: "worker", value: { at: now.toISOString() }, updatedAt: now })
    .onConflictDoUpdate({ target: systemStatus.key, set: { value: { at: now.toISOString() }, updatedAt: now } });
}

export function diskFreeRatio(path = "/"): number | null {
  try {
    const s = statfsSync(path);
    return s.blocks > 0 ? s.bavail / s.blocks : null;
  } catch {
    return null;
  }
}

export async function checkSystem(opts: { includeWorker: boolean; now?: Date; diskRatio?: number | null } = { includeWorker: true }): Promise<Problem[]> {
  const now = opts.now ?? new Date();
  const problems: Problem[] = [];
  if (opts.includeWorker) {
    const [w] = await db().select().from(systemStatus).where(eq(systemStatus.key, "worker"));
    const at = w ? new Date(String(w.value.at)) : null;
    if (!at || now.getTime() - at.getTime() > HEARTBEAT_MAX_MS) problems.push({ name: "worker", detail: at ? `Kein Lebenszeichen seit ${at.toISOString()}` : "Der Worker hat sich noch nie gemeldet" });
  }
  const cut = new Date(now.getTime() - BACKLOG_MS).toISOString();
  const [m] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM email_outbox WHERE status = 'pending' AND send_after < ${cut}::timestamptz`));
  if (m.n > 0) problems.push({ name: "email_backlog", detail: `${m.n} E-Mail(s) warten seit über 30 Minuten (Postmark oder Worker prüfen)` });
  const [c] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM channex_outbox WHERE status = 'pending' AND next_attempt_at < ${cut}::timestamptz`));
  if (c.n > 0) problems.push({ name: "channex_backlog", detail: `${c.n} Channex-Meldung(en) warten seit über 30 Minuten` });
  const [h] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM bookings WHERE status = 'hold' AND hold_expires_at < ${cut}::timestamptz`));
  if (h.n > 0) problems.push({ name: "stuck_holds", detail: `${h.n} Reservierung(en) sind seit über 30 Minuten abgelaufen und noch nicht freigegeben (Worker prüfen)` });
  const free = opts.diskRatio === undefined ? diskFreeRatio() : opts.diskRatio;
  if (free !== null && free < MIN_FREE_DISK) problems.push({ name: "disk", detail: `Nur noch ${(free * 100).toFixed(1)} % Speicherplatz frei` });
  return problems;
}

/** Alarm per Mail an PLATFORM_ALERT_EMAIL, pro Schlüssel höchstens alle 6 Stunden. Gibt zurück, ob gesendet wurde. */
export async function raiseAlert(key: string, subject: string, details: string, now = new Date(), repeatMs = REALERT_MS): Promise<boolean> {
  const id = `alert:${key}`;
  const [prev] = await db().select().from(systemStatus).where(eq(systemStatus.key, id));
  if (prev && now.getTime() - new Date(String(prev.value.at)).getTime() < repeatMs) return false;
  const to = env().PLATFORM_ALERT_EMAIL;
  if (to) await enqueueEmail(db(), { hotelId: null, template: "platform_alert", to, data: { subject, details } });
  console.error(`[alert] ${subject}: ${details}`);
  await db().insert(systemStatus).values({ key: id, value: { at: now.toISOString() }, updatedAt: now })
    .onConflictDoUpdate({ target: systemStatus.key, set: { value: { at: now.toISOString() }, updatedAt: now } });
  return true;
}

const NAMED = ["email_backlog", "channex_backlog", "stuck_holds", "disk"];

/** Läuft alle 10 Minuten im Worker: neue Probleme melden, behobene Probleme vergessen (dann wird ein Rückfall wieder gemeldet) */
export async function runWatchdog(now = new Date(), diskRatio?: number | null): Promise<{ problems: number; sent: number }> {
  const problems = await checkSystem({ includeWorker: false, now, diskRatio });
  let sent = 0;
  for (const p of problems) if (await raiseAlert(p.name, `Problem: ${p.name}`, p.detail, now)) sent++;
  const active = new Set(problems.map((p) => p.name));
  for (const n of NAMED) if (!active.has(n)) await db().delete(systemStatus).where(eq(systemStatus.key, `alert:${n}`));
  return { problems: problems.length, sent };
}

