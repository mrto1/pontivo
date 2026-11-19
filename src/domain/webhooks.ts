import crypto from "node:crypto";
import net from "node:net";

/** Webhooks (SPEC 19.22): Ereignisse, Signatur, Wiederholung, Schutz vor internen Zielen. Reine Logik. */
export const WEBHOOK_EVENTS = ["booking.confirmed", "booking.changed", "booking.cancelled", "booking.expired", "ping"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const isWebhookEvent = (s: string): s is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(s);

/** Wartezeit bis zum nächsten Versuch in Minuten (nach Versuch 1, 2, …); danach gilt die Zustellung als fehlgeschlagen */
export const RETRY_MINUTES = [1, 5, 30, 120, 720, 1440];
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
export const nextAttemptAt = (attempts: number, now: Date): Date | null => attempts >= MAX_ATTEMPTS ? null : new Date(now.getTime() + RETRY_MINUTES[attempts - 1] * 60_000);

export const newSecret = () => `whsec_${crypto.randomBytes(32).toString("base64url")}`;

/** Header «Pontivo-Signature: t=<unix>,v1=<hex>», HMAC-SHA256 über `${t}.${body}` mit dem Endpunkt-Geheimnis */
export function sign(secret: string, body: string, nowSec: number): string {
  return `t=${nowSec},v1=${crypto.createHmac("sha256", secret).update(`${nowSec}.${body}`).digest("hex")}`;
}

/** Prüfung beim Empfänger (für Dokumentation und Tests): Signatur stimmt und der Zeitstempel ist höchstens `toleranceSec` alt */
export function verifySignature(secret: string, body: string, header: string, nowSec: number, toleranceSec = 300): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!m || Math.abs(nowSec - Number(m[1])) > toleranceSec) return false;
  const want = Buffer.from(crypto.createHmac("sha256", secret).update(`${m[1]}.${body}`).digest("hex"));
  const got = Buffer.from(m[2]);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** Ist die IP-Adresse privat, lokal oder reserviert? (SSRF-Schutz: dorthin senden wir nie) */
export function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1" || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("fc") || x.startsWith("fd")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  return true; // keine gültige Adresse
}

/** Adresse eines Endpunkts: https, kein Benutzer/Passwort, kein Fragment, keine IP-Adresse als Host, kein localhost */
export function urlProblem(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "Adresse ungültig."; }
  if (u.protocol !== "https:") return "Nur https-Adressen sind erlaubt.";
  if (u.username || u.password) return "Adresse darf keinen Benutzernamen oder Passwort enthalten.";
  if (u.hash) return "Adresse darf kein Fragment (#) enthalten.";
  if (raw.length > 500) return "Adresse zu lang.";
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return "Interne Adressen sind nicht erlaubt.";
  if (net.isIP(h.replace(/^\[|\]$/g, ""))) return "Bitte einen Domainnamen statt einer IP-Adresse angeben.";
  return null;
}

/** Ursprung (https://host) einer Rückkehr-Adresse; null wenn ungültig */
export function originOf(raw: string): string | null {
  try { const u = new URL(raw); return u.protocol === "https:" && !u.username && !u.password ? u.origin : null; } catch { return null; }
}

/** Gehört die IP zur erlaubten Liste? Leere Liste = alle. Einträge: einzelne IPv4/IPv6-Adressen. */
export const ipAllowed = (list: string[], ip: string) => list.length === 0 || list.includes(ip);
