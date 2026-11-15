import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateRecoveryCodes, otpauthUri, totpCode, verifyTotp } from "../../src/domain/totp";

// RFC 6238 Anhang B: Geheimnis "12345678901234567890" (ASCII), SHA-1
const SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("Base32 hin und zurück", () => {
    expect(base32Decode(base32Encode(Buffer.from("Pontivo!")))).toEqual(Buffer.from("Pontivo!"));
    expect(SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });
  it("RFC-6238-Testvektoren (letzte 6 Stellen)", () => {
    expect(totpCode(SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(totpCode(SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpCode(SECRET, Math.floor(1234567890 / 30))).toBe("005924");
    expect(totpCode(SECRET, Math.floor(2000000000 / 30))).toBe("279037");
  });
  it("Toleranz ±1 Schritt, nicht mehr", () => {
    const now = 1_234_567_890_000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(SECRET, totpCode(SECRET, step), now)).toBe(step);
    expect(verifyTotp(SECRET, totpCode(SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(SECRET, totpCode(SECRET, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(SECRET, totpCode(SECRET, step - 2), now)).toBeNull();
  });
  it("Code nur einmal: Schritt ≤ lastStep wird abgelehnt", () => {
    const now = 1_234_567_890_000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(SECRET, totpCode(SECRET, step), now, step)).toBeNull();
  });
  it("lehnt Unsinn ab, akzeptiert Leerzeichen", () => {
    const now = 1_234_567_890_000;
    expect(verifyTotp(SECRET, "abc123", now)).toBeNull();
    expect(verifyTotp(SECRET, "12345", now)).toBeNull();
    const c = totpCode(SECRET, Math.floor(now / 30000));
    expect(verifyTotp(SECRET, `${c.slice(0, 3)} ${c.slice(3)}`, now)).not.toBeNull();
  });
  it("otpauth-URI und Wiederherstellungscodes", () => {
    expect(otpauthUri("ABC", "a@b.ch")).toBe("otpauth://totp/Pontivo:a%40b.ch?secret=ABC&issuer=Pontivo&algorithm=SHA1&digits=6&period=30");
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
  });
});
