import { describe, expect, it } from "vitest";
import { hashPassword, MIN_PASSWORD, passwordProblem, verifyPassword } from "../../src/auth/password";

describe("Passwort (SPEC 19.43)", () => {
  it("speichert nur einen gesalzenen Hash, nie das Passwort", async () => {
    const a = await hashPassword("testtest");
    const b = await hashPassword("testtest");
    expect(a).toMatch(/^scrypt1\$[^$]+\$[^$]+$/);
    expect(a).not.toContain("testtest");
    expect(a).not.toBe(b); // anderes Salz
  });
  it("prüft richtig und falsch", async () => {
    const h = await hashPassword("Ein sehr langes Passwort 123");
    expect(await verifyPassword("Ein sehr langes Passwort 123", h)).toBe(true);
    expect(await verifyPassword("ein sehr langes passwort 123", h)).toBe(false);
    expect(await verifyPassword("", h)).toBe(false);
  });
  it("kaputte oder fehlende Hashes lassen nie durch", async () => {
    for (const bad of [null, undefined, "", "x", "scrypt1$$", "md5$a$b"]) expect(await verifyPassword("testtest", bad)).toBe(false);
  });
  it("Mindestlänge und Höchstlänge", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD - 1))).toContain(String(MIN_PASSWORD));
    expect(passwordProblem("testtest")).toBeNull();
    expect(passwordProblem("a".repeat(201))).not.toBeNull();
  });
});
