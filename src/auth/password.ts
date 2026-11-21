import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const OPTS: crypto.ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const LEN = 32;

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

/** Passwort prüfen, bevor es gespeichert wird. Gibt die Meldung für den Menschen zurück oder null. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`;
  if (pw.length > MAX_PASSWORD) return `Das Passwort darf höchstens ${MAX_PASSWORD} Zeichen haben.`;
  return null;
}

/** Format `scrypt1$<Salt>$<Hash>` (Base64). Nie das Passwort selbst speichern. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt, LEN, OPTS);
  return `scrypt1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  const [tag, saltB64, hashB64] = (stored ?? "").split("$");
  if (tag !== "scrypt1" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(pw, Buffer.from(saltB64, "base64"), expected.length, OPTS);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Für unbekannte Adressen: gleich viel Rechenzeit wie bei einem echten Konto (verrät nicht, ob die Adresse existiert) */
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword(crypto.randomBytes(16).toString("hex")));
