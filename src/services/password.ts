import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from "../auth/password";

/**
 * Anmeldung mit E-Mail und Passwort → userId oder null. Immer gleich viel Rechenzeit; keine Auskunft, ob das Konto existiert.
 * «Nur Passkey» (`email_login_disabled`) sperrt auch das Passwort.
 */
export async function loginWithPassword(email: string, password: string): Promise<string | null> {
  const [u] = await db().select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  const ok = await verifyPassword(password, u?.passwordHash ?? (await dummyHash()));
  if (!u || !u.passwordHash || !ok || u.emailLoginDisabled) return null;
  return u.id;
}

export async function hasPassword(userId: string): Promise<boolean> {
  const [u] = await db().select({ h: users.passwordHash }).from(users).where(eq(users.id, userId));
  return !!u?.h;
}

export type PasswordResult = "ok" | "wrong" | { problem: string };

/**
 * Passwort setzen oder ändern. Hat das Konto schon eins, muss das aktuelle stimmen.
 * Ohne Passwort genügt die angemeldete Sitzung (erstes Passwort nach Einladung oder Login-Link).
 */
export async function changePassword(userId: string, current: string | null, next: string): Promise<PasswordResult> {
  const problem = passwordProblem(next);
  if (problem) return { problem };
  const [u] = await db().select({ h: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!u) return "wrong";
  if (u.h && !(await verifyPassword(current ?? "", u.h))) return "wrong";
  await db().update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  return "ok";
}

/** Ohne Prüfung des alten Passworts (Betreiber-Skript, Plattform-Verwaltung) */
export async function setPasswordUnchecked(userId: string, password: string): Promise<void> {
  await db().update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
}
