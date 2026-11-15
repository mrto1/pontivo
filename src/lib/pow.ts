import crypto from "node:crypto";
import { readShort, signShort } from "../auth/session";
import { env } from "../env";
import { rateLimitDb } from "./rate-limit-db";

/**
 * Rechenaufgabe (Proof of Work) für öffentliche Formulare auf Hotel-Websites (SPEC 18.11).
 * Ohne Konto, ohne Drittanbieter, auf jeder Domain. Der Server gibt eine signierte Aufgabe aus (Salt, Schwierigkeit),
 * der Browser sucht eine Zahl `nonce`, sodass SHA-256(salt + nonce) mit `bits` Nullbits beginnt. Das kostet einen Menschen
 * ca. 1 Sekunde, einen Bot mit Tausenden Anfragen aber viel Rechenzeit. Jede Aufgabe gilt nur einmal.
 * Der Beweis hat die Form `<aufgabe>.<nonce>`.
 */
export const POW_BITS = 16;
const CHALLENGE_TTL_SEC = 600;
const PASS_TTL_SEC = 30 * 60;

export const powRequired = () => (env().POW_REQUIRED === "1" ? true : env().POW_REQUIRED === "0" ? false : env().NODE_ENV === "production");

export function issueChallenge(now = Date.now(), bits = POW_BITS) {
  const salt = crypto.randomBytes(12).toString("hex");
  return { token: signShort({ s: salt, b: bits }, CHALLENGE_TTL_SEC, now), salt, bits };
}

export function leadingZeroBits(buf: Buffer): number {
  let n = 0;
  for (const byte of buf) {
    if (byte === 0) { n += 8; continue; }
    n += Math.clz32(byte) - 24;
    break;
  }
  return n;
}

/** Prüft die Lösung (ohne Einmal-Verbrauch). */
export function powSolved(proof: string | null | undefined, now = Date.now()): { salt: string } | null {
  if (!proof) return null;
  const i = proof.lastIndexOf(".");
  if (i < 0) return null;
  const c = readShort<{ s: string; b: number }>(proof.slice(0, i), now);
  const nonce = proof.slice(i + 1);
  if (!c || typeof c.s !== "string" || typeof c.b !== "number" || !/^\d{1,12}$/.test(nonce)) return null;
  return leadingZeroBits(crypto.createHash("sha256").update(c.s + nonce).digest()) >= c.b ? { salt: c.s } : null;
}

/** Lösung prüfen und verbrauchen (jede Aufgabe nur einmal). Ist die Prüfung ausgeschaltet, gilt alles als gelöst. */
export async function checkPow(proof: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!powRequired()) return true;
  const ok = powSolved(proof, now);
  if (!ok) return false;
  return rateLimitDb(`pow:${ok.salt}`, 1, CHALLENGE_TTL_SEC * 1000, new Date(now));
}

/** Pass für den Chat: eine gelöste Aufgabe gilt 30 Minuten (jede Nachricht eine Aufgabe wäre zu zäh). */
export async function issuePass(proof: string | null | undefined, now = Date.now()): Promise<string | null> {
  if (!(await checkPow(proof, now))) return null;
  return signShort({ k: "pow-pass" }, PASS_TTL_SEC, now);
}
export function checkPass(pass: string | null | undefined, now = Date.now()): boolean {
  if (!powRequired()) return true;
  return readShort<{ k: string }>(pass, now)?.k === "pow-pass";
}
