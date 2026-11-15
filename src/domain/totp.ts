import crypto from "node:crypto";

/** TOTP nach RFC 6238 (HMAC-SHA1, 6 Stellen, 30 Sekunden), kompatibel mit gängigen Authenticator-Apps. Reine Logik ohne I/O. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/[\s=]/g, "").toUpperCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Ungültiges Base32-Zeichen");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

export const totpStep = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_PERIOD);

export function totpCode(secret: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}

/**
 * Code prüfen mit ±1 Schritt Toleranz (Uhrabweichung). Gibt den akzeptierten Schritt zurück oder null.
 * Ein Schritt ≤ lastStep wird abgelehnt (Code nur einmal verwendbar).
 */
export function verifyTotp(secret: string, input: string, nowMs: number, lastStep = 0): number | null {
  const code = input.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const cur = totpStep(nowMs);
  for (const step of [cur, cur - 1, cur + 1]) {
    if (step <= lastStep) continue;
    const a = Buffer.from(totpCode(secret, step));
    if (crypto.timingSafeEqual(a, Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = "Pontivo"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD}`;
}

/** Wiederherstellungscodes: 10 Stück im Format xxxxx-xxxxx (ohne verwechselbare Zeichen) */
export function generateRecoveryCodes(n = 10): string[] {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => {
    const b = crypto.randomBytes(10);
    const s = Array.from(b, (x) => chars[x % chars.length]).join("");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export const normalizeRecoveryCode = (s: string) => s.trim().toLowerCase().replace(/\s/g, "");
