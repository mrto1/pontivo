import crypto from "node:crypto";
import { env } from "../env";

/**
 * Verschlüsselung sensibler Gästedaten in der Anwendungsschicht (SPEC 14.7): Geburtsdatum, Ausweisnummer, Unterschrift.
 * AES-256-GCM, Format "v1:<iv>:<tag>:<ciphertext>" (base64url). Schlüssel: GUEST_DATA_KEY (32 Byte, base64).
 */
// ASSUMPTION: Fehlt GUEST_DATA_KEY (Entwicklung/Test), wird ein Schlüssel per HKDF aus AUTH_SECRET abgeleitet.
// In Produktion ist GUEST_DATA_KEY Pflicht (siehe guestKey). Schlüsselwechsel: neue Version "v2" einführen.

let cache: { src: string; key: Buffer } | null = null;

function guestKey(): Buffer {
  const e = env();
  const src = e.GUEST_DATA_KEY ?? `hkdf:${e.AUTH_SECRET ?? ""}`;
  if (cache?.src === src) return cache.key;
  let key: Buffer;
  if (e.GUEST_DATA_KEY) {
    key = Buffer.from(e.GUEST_DATA_KEY, "base64");
    if (key.length !== 32) throw new Error("GUEST_DATA_KEY muss 32 Byte (base64) lang sein");
  } else {
    if (e.NODE_ENV === "production") throw new Error("GUEST_DATA_KEY fehlt (Modul Gäste)");
    key = Buffer.from(crypto.hkdfSync("sha256", e.AUTH_SECRET ?? "pontivo-dev-only", "pontivo", "guest-data", 32));
  }
  cache = { src, key };
  return key;
}

export function encryptField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", guestKey(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

export function decryptField(enc: string | null | undefined): string | null {
  if (!enc) return null;
  const [v, iv, tag, data] = enc.split(":");
  if (v !== "v1" || !iv || !tag || data === undefined) throw new Error("Unbekanntes Format verschlüsselter Daten");
  const d = crypto.createDecipheriv("aes-256-gcm", guestKey(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

export const encryptOpt = (s: string | null | undefined) => (s ? encryptField(s) : null);
