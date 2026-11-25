import crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { hotelMembers, hotelRoleOverrides, hotelRoles, hotels, loginTokens, users } from "../db/schema";
import { encodeCustomRole, isEditableStandardRole, ROLE_LABEL } from "../domain/roles";
import { sha256 } from "../domain/ids";
import { requireEnv, env } from "../env";
import { enqueueEmail } from "../email/enqueue";

export const SESSION_COOKIE = "hb_session";
const SESSION_DAYS = 30;
const TOKEN_MINUTES = 15;
/** Aktivierungslink aus der Registrierung: 3 Tage (die Mail wird oft erst später geöffnet) */
const ACTIVATE_MINUTES = 3 * 24 * 60;
export type TokenPurpose = "login" | "activate";

function sign(payload: string): string {
  return crypto.createHmac("sha256", requireEnv("AUTH_SECRET")).update(payload).digest("base64url");
}

/** Sitzung als signiertes Cookie: userId.expiresUnix.signatur */
export function createSessionValue(userId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function readSessionValue(value: string | undefined | null, now = Date.now()): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  const expected = sign(`${userId}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) * 1000 < now) return null;
  return userId;
}

/** Kurzlebiger signierter Wert (WebAuthn-Challenge, ausstehende 2FA): base64url(JSON).signatur */
export function signShort<T extends Record<string, unknown>>(data: T, ttlSec: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(now / 1000) + ttlSec })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readShort<T extends Record<string, unknown>>(value: string | undefined | null, now = Date.now()): (T & { exp: number }) | null {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof d.exp === "number" && d.exp * 1000 >= now ? d : null;
  } catch { return null; }
}

export const MFA_COOKIE = "hb_mfa";
export const WEBAUTHN_COOKIE = "hb_wa";

export function sessionCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: env().APP_BASE_URL.startsWith("https://"), path: "/", maxAge: SESSION_DAYS * 86400 };
}

/**
 * Magic-Link anfordern. Gibt den Link zurück (für Entwicklung ohne E-Mail-Versand), sonst null.
 * Unbekannte E-Mail-Adressen erhalten keinen Link, die Antwort an den Client ist trotzdem gleich.
 */
export async function requestLoginLink(email: string, now = new Date(), opts: { mail?: boolean; purpose?: TokenPurpose } = {}): Promise<string | null> {
  const [u] = await db().select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  // Anmeldung nur per Passkey: kein Link (Antwort an den Client bleibt gleich, keine Auskunft über das Konto)
  if (!u || u.emailLoginDisabled) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  const purpose = opts.purpose ?? "login";
  const minutes = purpose === "activate" ? ACTIVATE_MINUTES : TOKEN_MINUTES;
  await db().insert(loginTokens).values({ tokenHash: sha256(token), userId: u.id, purpose, expiresAt: new Date(now.getTime() + minutes * 60_000) });
  const link = `${env().APP_BASE_URL}/api/auth/${purpose === "activate" ? "activate" : "callback"}?token=${token}`;
  // mail: false = Link steckt in einer anderen Mail (Willkommensmail bei der Registrierung), keine zweite Mail
  if (opts.mail !== false) await enqueueEmail(db(), { hotelId: null, template: "login_link", to: u.email, data: { link } });
  return link;
}

/** Token einlösen (einmalig, 15 Minuten; Aktivierung 3 Tage) → userId. Ein Token gilt nur für seinen Zweck. */
export async function consumeLoginToken(token: string, now = new Date(), purpose: TokenPurpose = "login"): Promise<string | null> {
  const [row] = await db()
    .update(loginTokens)
    .set({ usedAt: now })
    .where(and(eq(loginTokens.tokenHash, sha256(token)), eq(loginTokens.purpose, purpose), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now)))
    .returning();
  if (!row) return null;
  // ein vor dem Abschalten ausgestellter Link gilt nicht mehr
  const [u] = await db().select({ off: users.emailLoginDisabled }).from(users).where(eq(users.id, row.userId));
  if (!u || (u.off && purpose === "login")) return null;
  // Wer den Link aus dem Postfach einlöst, hat die E-Mail-Adresse bewiesen
  await db().update(users).set({ emailVerifiedAt: now }).where(and(eq(users.id, row.userId), isNull(users.emailVerifiedAt)));
  return row.userId;
}

import { atLeast as atLeastRole, type Role } from "../domain/roles";
export type { Role };

export async function getUser(userId: string) {
  const [u] = await db().select().from(users).where(eq(users.id, userId));
  return u ?? null;
}

/** Hotels, die ein Benutzer sehen darf (Plattform-Admin: alle) */
export async function hotelsForUser(userId: string) {
  const u = await getUser(userId);
  if (!u) return [];
  if (u.isPlatformAdmin) {
    const all = await db().select().from(hotels).orderBy(hotels.name);
    return all.map((h) => ({ hotel: h, role: "owner" as Role }));
  }
  const rows = await db()
    .select({ hotel: hotels, role: hotelMembers.role })
    .from(hotelMembers)
    .innerJoin(hotels, eq(hotels.id, hotelMembers.hotelId))
    .where(eq(hotelMembers.userId, userId))
    .orderBy(hotels.name);
  return Promise.all(rows.map(async (r) => ({ hotel: r.hotel, role: (await resolveRole(r.hotel.id, r.role)) ?? ("service" as Role) })));
}

/** Rolle eines Benutzers in einem Hotel, null = kein Zugriff (SPEC 3) */
export async function roleIn(userId: string, hotelId: string): Promise<Role | null> {
  const u = await getUser(userId);
  if (!u) return null;
  if (u.isPlatformAdmin) return "owner";
  const [m] = await db().select().from(hotelMembers).where(and(eq(hotelMembers.userId, userId), eq(hotelMembers.hotelId, hotelId)));
  return m ? resolveRole(hotelId, m.role) : null;
}

/** In der DB steht bei eigenen Rollen `custom:<id>`; hier wird daraus die Rolle mit Name und Seiten. Rolle gelöscht = kein Zugriff. */
async function resolveRole(hotelId: string, stored: string): Promise<Role | null> {
  if (isEditableStandardRole(stored)) {
    // Standardrolle, die der Betrieb angepasst hat: gilt wie eine eigene Rolle mit dessen Namen und Seiten
    const [o] = await db().select().from(hotelRoleOverrides).where(and(eq(hotelRoleOverrides.hotelId, hotelId), eq(hotelRoleOverrides.role, stored)));
    return o ? encodeCustomRole(o.name ?? ROLE_LABEL[stored], o.areas) : stored;
  }
  if (!stored.startsWith("custom:")) return stored as Role;
  const [r] = await db().select().from(hotelRoles).where(and(eq(hotelRoles.id, stored.slice(7)), eq(hotelRoles.hotelId, hotelId)));
  return r ? encodeCustomRole(r.name, r.areas) : null;
}

export const atLeast = atLeastRole;
