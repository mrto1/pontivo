import { describe, expect, it } from "vitest";
import { authName, codeWindow, generateCode, validCode } from "../../src/domain/door-codes";

describe("Zutrittscodes (SPEC 18.5)", () => {
  it("Code: 6 Ziffern ohne 0, nicht mit 12 beginnend", () => {
    for (let i = 0; i < 500; i++) expect(validCode(generateCode())).toBe(true);
    expect(generateCode(() => 0)).toBe(111111);
    let n = 0; // erste Ziehung «12…» wird verworfen
    expect(String(generateCode((m) => (n++ < 2 ? [0, 1][n - 1] : 4) % m))).not.toMatch(/^12/);
    expect(validCode(120000)).toBe(false);
    expect(validCode(123456)).toBe(false);
    expect(validCode(103456)).toBe(false);
  });
  it("Gültigkeit in Ortszeit (Sommer-/Winterzeit)", () => {
    const w = codeWindow("2026-12-01", "2026-12-03", "15:00:00", "11:00:00", "Europe/Zurich");
    expect(w.from.toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect(w.until.toISOString()).toBe("2026-12-03T10:00:00.000Z");
    expect(codeWindow("2026-07-01", "2026-07-02", "15:00", "11:00", "Europe/Zurich").from.toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });
  it("Name höchstens 32 Zeichen", () => {
    expect(authName("BK-ABCD1234")).toBe("Pontivo BK-ABCD1234");
    expect(authName("x".repeat(60))).toHaveLength(32);
  });
});
