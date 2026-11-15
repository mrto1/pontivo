import crypto from "node:crypto";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { emailChanges, loginTokens, users } from "../db/schema";
import { sha256 } from "../domain/ids";
import { isDisposableEmail } from "../domain/disposable-email";
import { enqueueEmail } from "../email/enqueue";
import { env } from "../env";
import { rateLimitDb } from "../lib/rate-limit-db";
import { audit } from "./audit";
import { hasTotp, verifySecondFactor } from "./mfa";

/**
 * E-Mail-Adresse des Kontos ändern (SPEC 18.10): Link an die NEUE Adresse (60 Minuten, einmalig), Hinweis an die ALTE.
 * Mit aktiver Authenticator-App muss zusätzlich ein gültiger Code eingegeben werden.
 * Die Antwort verrät nicht, ob die neue Adresse schon vergeben ist.
 */
export const EMAIL_CHANGE_MINUTES = 60;

export type RequestResult = "sent" | "invalid" | "same" | "disposable" | "code" | "rate";

export async function requestEmailChange(userId: string, newEmailRaw: string, code?: string, now = new Date()): Promise<RequestResult> {
  const parsed = z.string().trim().email().max(200).safeParse(newEmailRaw);
  if (!parsed.success) return "invalid";
  const newEmail = parsed.data.toLowerCase();
  const [u] = await db().select().from(users).where(eq(users.id, userId));
  if (!u) return "invalid";
  if (u.email.toLowerCase() === newEmail) return "same";
  if (isDisposableEmail(newEmail)) return "disposable";
  if (!(await rateLimitDb(`email-change:${userId}`, 3, 3_600_000, now))) return "rate";
  if ((await hasTotp(userId)) && !(await verifySecondFactor(userId, code ?? "", now.getTime()))) return "code";
  const [taken] = await db().select({ id: users.id }).from(users).where(and(eq(users.email, newEmail), ne(users.id, userId)));
  if (taken) return "sent"; // keine Auskunft, ob die Adresse vergeben ist; es wird nur nichts verschickt
  const token = crypto.randomBytes(32).toString("base64url");
  await db().insert(emailChanges).values({ tokenHash: sha256(token), userId, newEmail, expiresAt: new Date(now.getTime() + EMAIL_CHANGE_MINUTES * 60_000) });
  const link = `${env().APP_BASE_URL}/api/auth/email-change?token=${token}`;
  await enqueueEmail(db(), { hotelId: null, template: "email_change_confirm", to: newEmail, data: { link } });
  await enqueueEmail(db(), { hotelId: null, template: "email_change_notice", to: u.email, data: { newEmail, done: false, nonce: token.slice(0, 8) } });
  await audit(db(), { hotelId: null, actor: `user:${userId}`, action: "user.email_change_requested", entity: "user", entityId: userId, details: {} });
  return "sent";
}

/** Link einlösen → neue Adresse gilt, ist bestätigt; offene Anmelde-Links der alten Adresse werden ungültig. */
export async function confirmEmailChange(token: string, now = new Date()): Promise<{ userId: string; email: string } | null> {
  const [row] = await db().update(emailChanges).set({ usedAt: now })
    .where(and(eq(emailChanges.tokenHash, sha256(token)), isNull(emailChanges.usedAt), gt(emailChanges.expiresAt, now))).returning();
  if (!row) return null;
  const [u] = await db().select().from(users).where(eq(users.id, row.userId));
  if (!u) return null;
  const [taken] = await db().select({ id: users.id }).from(users).where(and(eq(users.email, row.newEmail), ne(users.id, row.userId)));
  if (taken) return null;
  const oldEmail = u.email;
  await db().transaction(async (tx) => {
    await tx.update(users).set({ email: row.newEmail, emailVerifiedAt: now }).where(eq(users.id, row.userId));
    await tx.update(loginTokens).set({ usedAt: now }).where(and(eq(loginTokens.userId, row.userId), isNull(loginTokens.usedAt)));
    await tx.update(emailChanges).set({ usedAt: now }).where(and(eq(emailChanges.userId, row.userId), isNull(emailChanges.usedAt)));
    await audit(tx, { hotelId: null, actor: `user:${row.userId}`, action: "user.email_changed", entity: "user", entityId: row.userId, details: { from: oldEmail, to: row.newEmail } });
  });
  await enqueueEmail(db(), { hotelId: null, template: "email_change_notice", to: oldEmail, data: { newEmail: row.newEmail, done: true, nonce: row.tokenHash.slice(0, 8) } });
  return { userId: row.userId, email: row.newEmail };
}
