import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { users } from "../../src/db/schema";
import { consumeLoginToken } from "../../src/auth/session";
import { registerHost } from "../../src/services/onboarding";
import { loginWithPassword } from "../../src/services/password";
import { uid } from "../helpers";

afterAll(closeDb);

const reg = (o: Record<string, unknown> = {}) => registerHost({
  propertyType: "apartment", name: `Chalet ${uid()}`, contactName: "Ruth Keller", email: `host-${uid()}@example.ch`,
  canton: "GR", municipality: `Testdorf-${uid()}`, acceptTerms: true, password: "Testpasswort-123", ...o,
} as never);
const tokenOf = (link: string | null) => new URL(link!).searchParams.get("token")!;

describe("Registrierung mit Passwort und Aktivierungslink", () => {
  it("speichert das Passwort (gehasht), der Link bestätigt nur die Adresse und meldet nicht an", async () => {
    const { hotel, loginLink } = await reg();
    expect(loginLink).toContain("/api/auth/activate?token=");
    const [u] = await db().select().from(users).where(eq(users.email, hotel.contactEmail));
    expect(u.passwordHash).toMatch(/^scrypt1\$/);
    expect(u.passwordHash).not.toContain("Testpasswort");
    expect(u.emailVerifiedAt).toBeNull();
    // Der Aktivierungslink gilt nicht als Login-Link
    expect(await consumeLoginToken(tokenOf(loginLink))).toBeNull();
    expect(await consumeLoginToken(tokenOf(loginLink), new Date(), "activate")).toBe(u.id);
    expect((await db().select().from(users).where(eq(users.id, u.id)))[0].emailVerifiedAt).not.toBeNull();
    expect(await consumeLoginToken(tokenOf(loginLink), new Date(), "activate")).toBeNull(); // einmalig
    // Anmeldung nur mit dem Passwort
    expect(await loginWithPassword(hotel.contactEmail, "Testpasswort-123")).toBe(u.id);
    expect(await loginWithPassword(hotel.contactEmail, "falsch-falsch")).toBeNull();
  });

  it("Aktivierung gilt 3 Tage, ein Login-Link nicht als Aktivierung; zu kurzes Passwort wird abgelehnt", async () => {
    const { loginLink } = await reg();
    expect(await consumeLoginToken(tokenOf(loginLink), new Date(Date.now() + 4 * 86400_000), "activate")).toBeNull();
    const ok = await reg();
    expect(await consumeLoginToken(tokenOf(ok.loginLink), new Date(Date.now() + 2 * 86400_000), "activate")).toBeTruthy();
    await expect(reg({ password: "kurz" })).rejects.toThrow(/mindestens 8/);
  });
});
