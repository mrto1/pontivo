import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { userPasskeys, users } from "../../src/db/schema";
import { totpCode, totpStep } from "../../src/domain/totp";
import { decryptField } from "../../src/lib/guest-crypto";
import { userTotp } from "../../src/db/schema";
import {
  beginTotp, confirmTotp, deletePasskey, disableTotp, hasTotp, listPasskeys, passkeyLoginOptions, passkeyRegistrationOptions,
  recoveryCodesLeft, regenerateRecoveryCodes, verifySecondFactor,
} from "../../src/services/mfa";

afterAll(closeDb);

const mkUser = async () => (await db().insert(users).values({ email: `mfa-${Math.random().toString(36).slice(2)}@example.ch` }).returning())[0];
const secretOf = async (id: string) => decryptField((await db().select().from(userTotp).where(eq(userTotp.userId, id)))[0].secretEnc)!;

describe("Authenticator-App (TOTP)", () => {
  it("Einrichtung, Bestätigung, Anmeldung, Einmal-Code, Wiederherstellung, Ausschalten", async () => {
    const u = await mkUser();
    expect(await hasTotp(u.id)).toBe(false);
    const b = await beginTotp(u.id);
    expect(b.qr).toMatch(/^data:image\/png/);
    expect(b.uri).toContain(`secret=${b.secret}`);
    // Geheimnis liegt verschlüsselt in der DB
    const [row] = await db().select().from(userTotp).where(eq(userTotp.userId, u.id));
    expect(row.secretEnc).not.toContain(b.secret);
    expect(await hasTotp(u.id)).toBe(false); // noch unbestätigt
    expect(await verifySecondFactor(u.id, "000000")).toBe(false);

    const now = Date.now();
    expect(await confirmTotp(u.id, "000000", now)).toBeNull();
    const codes = await confirmTotp(u.id, totpCode(b.secret, totpStep(now)), now);
    expect(codes).toHaveLength(10);
    expect(await hasTotp(u.id)).toBe(true);
    await expect(beginTotp(u.id)).rejects.toThrow();

    // der bei der Bestätigung genutzte Code ist verbraucht, der nächste Schritt gilt
    expect(await verifySecondFactor(u.id, totpCode(b.secret, totpStep(now)), now)).toBe(false);
    const later = now + 30_000;
    const c2 = totpCode(b.secret, totpStep(later));
    expect(await verifySecondFactor(u.id, c2, later)).toBe(true);
    expect(await verifySecondFactor(u.id, c2, later)).toBe(false); // Replay

    // Wiederherstellungscode: einmal
    expect(await recoveryCodesLeft(u.id)).toBe(10);
    expect(await verifySecondFactor(u.id, codes![0].toUpperCase())).toBe(true);
    expect(await verifySecondFactor(u.id, codes![0])).toBe(false);
    expect(await recoveryCodesLeft(u.id)).toBe(9);

    // neue Codes nur mit gültigem Code; alte werden ungültig
    expect(await regenerateRecoveryCodes(u.id, "000000")).toBeNull();
    const fresh = await regenerateRecoveryCodes(u.id, codes![1]);
    expect(fresh).toHaveLength(10);
    expect(await verifySecondFactor(u.id, codes![2])).toBe(false);

    // Ausschalten verlangt einen Code
    expect(await disableTotp(u.id, "000000")).toBe(false);
    expect(await hasTotp(u.id)).toBe(true);
    expect(await disableTotp(u.id, fresh![0])).toBe(true);
    expect(await hasTotp(u.id)).toBe(false);
    expect(await recoveryCodesLeft(u.id)).toBe(0);
  });

  it("Geheimnis ist je Benutzer eigen", async () => {
    const a = await mkUser(), b = await mkUser();
    await beginTotp(a.id); await beginTotp(b.id);
    expect(await secretOf(a.id)).not.toBe(await secretOf(b.id));
    const codeA = totpCode(await secretOf(a.id), totpStep(Date.now()));
    expect(await confirmTotp(b.id, codeA)).toBeNull();
  });
});

describe("Passkeys", () => {
  it("Optionen: Registrierung schliesst vorhandene aus, Anmeldung ohne E-Mail, Gerätesperre Pflicht", async () => {
    const u = await mkUser();
    await db().insert(userPasskeys).values({ userId: u.id, credentialId: `cred-${u.id}`, publicKey: "AAAA", name: "Test" });
    const o = await passkeyRegistrationOptions(u.id);
    expect(o.excludeCredentials?.map((c) => c.id)).toContain(`cred-${u.id}`);
    expect(o.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    expect(o.rp.id).toBe("localhost");
    const l = await passkeyLoginOptions();
    expect(l.allowCredentials ?? []).toHaveLength(0);
    expect(l.userVerification).toBe("required");
    expect(l.challenge.length).toBeGreaterThan(20);
  });

  it("Entfernen nur für das eigene Konto", async () => {
    const a = await mkUser(), b = await mkUser();
    const [pk] = await db().insert(userPasskeys).values({ userId: a.id, credentialId: `c-${a.id}`, publicKey: "AAAA", name: "A" }).returning();
    expect(await deletePasskey(b.id, pk.id)).toBe(false);
    expect(await listPasskeys(a.id)).toHaveLength(1);
    expect(await deletePasskey(a.id, pk.id)).toBe(true);
    expect(await listPasskeys(a.id)).toHaveLength(0);
  });
});
