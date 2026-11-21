import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { users } from "../../src/db/schema";
import { addMember } from "../../src/services/settings";
import { changePassword, hasPassword, loginWithPassword, setPasswordUnchecked } from "../../src/services/password";
import { setEmailLoginDisabled } from "../../src/services/mfa";
import { makeHotel } from "../helpers";

afterAll(closeDb);

async function account() {
  const h = await makeHotel();
  const email = `pw-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "t");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  return { email, id: u.id };
}

describe("Anmeldung mit Passwort (SPEC 19.43)", () => {
  it("ohne Passwort keine Anmeldung, mit Passwort ja (Adresse ohne Beachtung der Gross-/Kleinschreibung)", async () => {
    const a = await account();
    expect(await hasPassword(a.id)).toBe(false);
    expect(await loginWithPassword(a.email, "testtest")).toBeNull();
    await setPasswordUnchecked(a.id, "testtest");
    expect(await hasPassword(a.id)).toBe(true);
    expect(await loginWithPassword(a.email, "testtest")).toBe(a.id);
    expect(await loginWithPassword(a.email.toUpperCase(), "testtest")).toBe(a.id);
    expect(await loginWithPassword(a.email, "falsch")).toBeNull();
    expect(await loginWithPassword("gibt-es-nicht@example.ch", "testtest")).toBeNull();
  });

  it("erstes Passwort braucht kein altes, Ändern schon", async () => {
    const a = await account();
    expect(await changePassword(a.id, null, "kurz")).toEqual({ problem: expect.stringContaining("mindestens") });
    expect(await changePassword(a.id, null, "erstes-passwort")).toBe("ok");
    expect(await changePassword(a.id, null, "zweites-passwort")).toBe("wrong");
    expect(await changePassword(a.id, "falsch", "zweites-passwort")).toBe("wrong");
    expect(await changePassword(a.id, "erstes-passwort", "zweites-passwort")).toBe("ok");
    expect(await loginWithPassword(a.email, "erstes-passwort")).toBeNull();
    expect(await loginWithPassword(a.email, "zweites-passwort")).toBe(a.id);
  });

  it("«Nur Passkey» sperrt auch das Passwort", async () => {
    const a = await account();
    await setPasswordUnchecked(a.id, "testtest");
    await db().update(users).set({ emailLoginDisabled: true }).where(eq(users.id, a.id));
    expect(await loginWithPassword(a.email, "testtest")).toBeNull();
    await db().update(users).set({ emailLoginDisabled: false }).where(eq(users.id, a.id));
    expect(await loginWithPassword(a.email, "testtest")).toBe(a.id);
    expect(await setEmailLoginDisabled(a.id, true)).toBe(false); // ohne 2 Passkeys nicht möglich
  });
});
