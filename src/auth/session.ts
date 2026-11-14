import crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { hotelMembers, hotels, loginTokens, users } from "../db/schema";
import { sha256 } from "../domain/ids";
import { requireEnv, env } from "../env";
import { enqueueEmail } from "../email/enqueue";

export const SESSION_COOKIE = "hb_session";
const SESSION_DAYS = 30;
const TOKEN_MINUTES = 15;

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

/**
 * Magic-Link anfordern. Gibt den Link zurück (für Entwicklung ohne E-Mail-Versand), sonst null.
 * Unbekannte E-Mail-Adressen erhalten keinen Link, die Antwort an den Client ist trotzdem gleich.
 */
export async function requestLoginLink(email: string, now = new Date()): Promise<string | null> {
  const [u] = await db().select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!u) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  await db().insert(loginTokens).values({ tokenHash: sha256(token), userId: u.id, expiresAt: new Date(now.getTime() + TOKEN_MINUTES * 60_000) });
  const link = `${env().APP_BASE_URL}/api/auth/callback?token=${token}`;
  await enqueueEmail(db(), { hotelId: null, template: "login_link", to: u.email, data: { link } });
  return link;
}

/** Token einlösen (einmalig, 15 Minuten) → userId */
export async function consumeLoginToken(token: string, now = new Date()): Promise<string | null> {
  const [row] = await db()
    .update(loginTokens)
    .set({ usedAt: now })
    .where(and(eq(loginTokens.tokenHash, sha256(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now)))
    .returning();
  return row?.userId ?? null;
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
  return rows.map((r) => ({ hotel: r.hotel, role: r.role as Role }));
}

/** Rolle eines Benutzers in einem Hotel, null = kein Zugriff (SPEC 3) */
export async function roleIn(userId: string, hotelId: string): Promise<Role | null> {
  const u = await getUser(userId);
  if (!u) return null;
  if (u.isPlatformAdmin) return "owner";
  const [m] = await db().select().from(hotelMembers).where(and(eq(hotelMembers.userId, userId), eq(hotelMembers.hotelId, hotelId)));
  return (m?.role as Role) ?? null;
}

export const atLeast = atLeastRole;
