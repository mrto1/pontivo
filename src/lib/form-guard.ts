import { readShort, signShort } from "../auth/session";

/**
 * Unsichtbare Formularprüfung ohne Drittanbieter: verstecktes Feld (Honeypot) und Mindestzeit zwischen Seitenaufruf und Absenden.
 * Das Zeitfeld ist signiert (nicht fälschbar) und läuft nach 2 Stunden ab.
 */
export const MIN_FILL_MS = 3000;
export const HONEYPOT_FIELD = "website";
export const GUARD_FIELD = "_fg";
const MAX_AGE_SEC = 2 * 3600;

export const issueGuardToken = (now = Date.now()) => signShort({ t: now }, MAX_AGE_SEC, now);

export type GuardResult = { ok: true } | { ok: false; reason: "honeypot" | "token" | "too_fast" };

export function checkGuard(fields: { honeypot?: string | null; token?: string | null }, now = Date.now(), minMs = MIN_FILL_MS): GuardResult {
  if (fields.honeypot && fields.honeypot.trim()) return { ok: false, reason: "honeypot" };
  const t = readShort<{ t: number }>(fields.token, now);
  if (!t || typeof t.t !== "number") return { ok: false, reason: "token" };
  if (now - t.t < minMs) return { ok: false, reason: "too_fast" };
  return { ok: true };
}

export const checkGuardForm = (f: FormData, now = Date.now(), minMs = MIN_FILL_MS) =>
  checkGuard({ honeypot: String(f.get(HONEYPOT_FIELD) ?? ""), token: String(f.get(GUARD_FIELD) ?? "") }, now, minMs);
