import { and, eq, isNull, lt } from "drizzle-orm";
import QRCode from "qrcode";
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON, type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { db } from "../db/client";
import { userPasskeys, userRecoveryCodes, userTotp, users } from "../db/schema";
import { env } from "../env";
import { sha256 } from "../domain/ids";
import { decryptField, encryptField } from "../lib/guest-crypto";
import { generateRecoveryCodes, generateTotpSecret, normalizeRecoveryCode, otpauthUri, verifyTotp } from "../domain/totp";

/** Passkeys (WebAuthn) und Authenticator-App (TOTP). SPEC 18.6 */
export function rp() {
  const url = new URL(env().APP_BASE_URL);
  return { rpID: url.hostname, origin: url.origin, rpName: "Pontivo" };
}

// ---------- Passkeys ----------

export const listPasskeys = (userId: string) =>
  db().select({ id: userPasskeys.id, name: userPasskeys.name, createdAt: userPasskeys.createdAt, lastUsedAt: userPasskeys.lastUsedAt })
    .from(userPasskeys).where(eq(userPasskeys.userId, userId)).orderBy(userPasskeys.createdAt);

export async function deletePasskey(userId: string, id: string): Promise<boolean> {
  const r = await db().delete(userPasskeys).where(and(eq(userPasskeys.id, id), eq(userPasskeys.userId, userId))).returning({ id: userPasskeys.id });
  return r.length > 0;
}

export async function passkeyRegistrationOptions(userId: string) {
  const [u] = await db().select().from(users).where(eq(users.id, userId));
  if (!u) throw new Error("Benutzer nicht gefunden");
  const existing = await db().select().from(userPasskeys).where(eq(userPasskeys.userId, userId));
  return generateRegistrationOptions({
    rpName: rp().rpName, rpID: rp().rpID,
    userName: u.email, userDisplayName: u.name ?? u.email,
    userID: new TextEncoder().encode(u.id),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports ? (c.transports.split(",") as AuthenticatorTransportFuture[]) : undefined })),
    // Passkey = sichtbar auf dem Gerät auffindbar (anmelden ohne E-Mail-Eingabe)
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
}

export async function verifyPasskeyRegistration(userId: string, response: RegistrationResponseJSON, challenge: string, name: string): Promise<boolean> {
  const v = await verifyRegistrationResponse({
    response, expectedChallenge: challenge, expectedOrigin: rp().origin, expectedRPID: rp().rpID, requireUserVerification: true,
  });
  if (!v.verified || !v.registrationInfo) return false;
  const c = v.registrationInfo.credential;
  await db().insert(userPasskeys).values({
    userId, credentialId: c.id, publicKey: Buffer.from(c.publicKey).toString("base64url"), counter: c.counter,
    transports: c.transports?.join(",") ?? null, name: name.trim().slice(0, 60) || "Passkey",
  });
  return true;
}

export const passkeyLoginOptions = () =>
  // Ohne allowCredentials: das Gerät zeigt die bei Pontivo gespeicherten Passkeys zur Auswahl
  generateAuthenticationOptions({ rpID: rp().rpID, userVerification: "required" });

/** Anmeldung per Passkey → userId. Passkey mit Gerätesperre gilt als starke Anmeldung (ersetzt die 2. Stufe). */
export async function verifyPasskeyLogin(response: AuthenticationResponseJSON, challenge: string, now = new Date()): Promise<string | null> {
  const [pk] = await db().select().from(userPasskeys).where(eq(userPasskeys.credentialId, response.id));
  if (!pk) return null;
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: rp().origin, expectedRPID: rp().rpID, requireUserVerification: true,
      credential: { id: pk.credentialId, publicKey: Buffer.from(pk.publicKey, "base64url"), counter: pk.counter, transports: pk.transports ? (pk.transports.split(",") as AuthenticatorTransportFuture[]) : undefined },
    });
  } catch { return null; }
  if (!v.verified) return null;
  await db().update(userPasskeys).set({ counter: v.authenticationInfo.newCounter, lastUsedAt: now }).where(eq(userPasskeys.id, pk.id));
  return pk.userId;
}

// ---------- TOTP ----------

export async function hasTotp(userId: string): Promise<boolean> {
  const [r] = await db().select().from(userTotp).where(eq(userTotp.userId, userId));
  return !!r?.confirmedAt;
}

/** Einrichtung starten: neues Geheimnis (noch unbestätigt) + QR-Code. Überschreibt nur eine unbestätigte Einrichtung. */
export async function beginTotp(userId: string) {
  if (await hasTotp(userId)) throw new Error("2FA ist bereits aktiv");
  const [u] = await db().select().from(users).where(eq(users.id, userId));
  if (!u) throw new Error("Benutzer nicht gefunden");
  const secret = generateTotpSecret();
  await db().insert(userTotp).values({ userId, secretEnc: encryptField(secret) })
    .onConflictDoUpdate({ target: userTotp.userId, set: { secretEnc: encryptField(secret), confirmedAt: null, lastStep: 0 } });
  const uri = otpauthUri(secret, u.email);
  return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await db().delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
  await db().insert(userRecoveryCodes).values(codes.map((c) => ({ userId, codeHash: sha256(normalizeRecoveryCode(c)) })));
  return codes;
}

/** Ersten Code bestätigen → 2FA aktiv, Wiederherstellungscodes werden einmalig angezeigt */
export async function confirmTotp(userId: string, code: string, now = Date.now()): Promise<string[] | null> {
  const [r] = await db().select().from(userTotp).where(eq(userTotp.userId, userId));
  if (!r || r.confirmedAt) return null;
  const step = verifyTotp(decryptField(r.secretEnc)!, code, now);
  if (step === null) return null;
  await db().update(userTotp).set({ confirmedAt: new Date(now), lastStep: step }).where(eq(userTotp.userId, userId));
  return replaceRecoveryCodes(userId);
}

/** 2. Faktor beim Anmelden: Authenticator-Code oder (einmaliger) Wiederherstellungscode */
export async function verifySecondFactor(userId: string, input: string, now = Date.now()): Promise<boolean> {
  const [r] = await db().select().from(userTotp).where(eq(userTotp.userId, userId));
  if (!r?.confirmedAt) return false;
  const step = verifyTotp(decryptField(r.secretEnc)!, input, now, r.lastStep);
  if (step !== null) {
    // atomar: nur wenn der Schritt noch nicht verbraucht wurde
    const upd = await db().update(userTotp).set({ lastStep: step }).where(and(eq(userTotp.userId, userId), lt(userTotp.lastStep, step))).returning();
    return upd.length > 0;
  }
  const hash = sha256(normalizeRecoveryCode(input));
  const used = await db().update(userRecoveryCodes).set({ usedAt: new Date(now) })
    .where(and(eq(userRecoveryCodes.userId, userId), eq(userRecoveryCodes.codeHash, hash), isNull(userRecoveryCodes.usedAt))).returning();
  return used.length > 0;
}

/** 2FA ausschalten (verlangt einen gültigen Code) */
export async function disableTotp(userId: string, code: string, now = Date.now()): Promise<boolean> {
  if (!(await verifySecondFactor(userId, code, now))) return false;
  await db().delete(userTotp).where(eq(userTotp.userId, userId));
  await db().delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
  return true;
}

export async function regenerateRecoveryCodes(userId: string, code: string, now = Date.now()): Promise<string[] | null> {
  if (!(await verifySecondFactor(userId, code, now))) return null;
  return replaceRecoveryCodes(userId);
}

export async function recoveryCodesLeft(userId: string): Promise<number> {
  const rows = await db().select().from(userRecoveryCodes).where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));
  return rows.length;
}
