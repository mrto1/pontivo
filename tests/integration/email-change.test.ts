import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { emailOutbox, users, userTotp } from "../../src/db/schema";
import { totpCode, totpStep } from "../../src/domain/totp";
import { decryptField } from "../../src/lib/guest-crypto";
import { beginTotp, confirmTotp } from "../../src/services/mfa";
import { confirmEmailChange, requestEmailChange } from "../../src/services/email-change";

afterAll(closeDb);

const uid = () => Math.random().toString(36).slice(2);
const mk = async (email = `ec-${uid()}@example.ch`) => (await db().insert(users).values({ email }).returning())[0];
const mails = (to: string) => db().select().from(emailOutbox).where(eq(emailOutbox.toEmail, to));
const tokenOf = async (to: string) => new URL(String(((await mails(to)).find((m) => m.template === "email_change_confirm")!.data as { link: string }).link)).searchParams.get("token")!;

describe("E-Mail-Adresse ändern", () => {
  it("Link an neue Adresse, Hinweis an alte, einmalig einlösbar", async () => {
    const u = await mk();
    const neu = `neu-${uid()}@example.ch`;
    expect(await requestEmailChange(u.id, neu)).toBe("sent");
    expect((await mails(u.email)).some((m) => m.template === "email_change_notice")).toBe(true);
    const t = await tokenOf(neu);
    expect((await db().select().from(users).where(eq(users.id, u.id)))[0].email).toBe(u.email); // noch alt
    expect(await confirmEmailChange(t)).toMatchObject({ userId: u.id, email: neu });
    const [fresh] = await db().select().from(users).where(eq(users.id, u.id));
    expect(fresh.email).toBe(neu);
    expect(fresh.emailVerifiedAt).not.toBeNull();
    expect(await confirmEmailChange(t)).toBeNull();
  });

  it("ungültig, gleich, Wegwerf-Adresse, abgelaufen", async () => {
    const u = await mk();
    expect(await requestEmailChange(u.id, "kein-mail")).toBe("invalid");
    expect(await requestEmailChange(u.id, u.email.toUpperCase())).toBe("same");
    expect(await requestEmailChange(u.id, "x@mailinator.com")).toBe("disposable");
    const neu = `neu-${uid()}@example.ch`;
    await requestEmailChange(u.id, neu);
    expect(await confirmEmailChange(await tokenOf(neu), new Date(Date.now() + 61 * 60_000))).toBeNull();
  });

  it("vergebene Adresse: gleiche Antwort, aber nichts verschickt", async () => {
    const a = await mk();
    const b = await mk();
    expect(await requestEmailChange(a.id, b.email)).toBe("sent");
    expect((await mails(b.email)).some((m) => m.template === "email_change_confirm")).toBe(false);
  });

  it("mit Authenticator-App ist ein gültiger Code nötig", async () => {
    const u = await mk();
    const b = await beginTotp(u.id);
    const secret = decryptField((await db().select().from(userTotp).where(eq(userTotp.userId, u.id)))[0].secretEnc)!;
    expect(b.secret).toBeTruthy();
    expect(await confirmTotp(u.id, totpCode(secret, totpStep(Date.now())))).toBeTruthy();
    const neu = `neu-${uid()}@example.ch`;
    expect(await requestEmailChange(u.id, neu)).toBe("code");
    expect(await requestEmailChange(u.id, neu, "000000")).toBe("code");
    expect((await mails(neu)).length).toBe(0);
    expect(await requestEmailChange(u.id, neu, totpCode(secret, totpStep(Date.now()) + 1))).toBe("sent");
  });
});
