import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { issueChallenge, leadingZeroBits, powSolved } from "../../src/lib/pow";

const solve = (c: { token: string; salt: string; bits: number }) => {
  for (let n = 0; ; n++) if (leadingZeroBits(crypto.createHash("sha256").update(c.salt + n).digest()) >= c.bits) return `${c.token}.${n}`;
};

describe("Rechenaufgabe (Proof of Work)", () => {
  it("zählt führende Nullbits", () => {
    expect(leadingZeroBits(Buffer.from([0, 0, 0x10]))).toBe(19);
    expect(leadingZeroBits(Buffer.from([0x80]))).toBe(0);
    expect(leadingZeroBits(Buffer.from([0, 0xff]))).toBe(8);
  });
  it("gelöste Aufgabe wird akzeptiert, falsche, verfälschte und abgelaufene nicht", () => {
    const c = issueChallenge(Date.now(), 10);
    const proof = solve(c);
    expect(powSolved(proof)?.salt).toBe(c.salt);
    let bad = 0;
    while (leadingZeroBits(crypto.createHash("sha256").update(c.salt + bad).digest()) >= c.bits) bad++;
    expect(powSolved(`${c.token}.${bad}`)).toBeNull(); // Zahl ohne genug Nullbits
    expect(powSolved("x.1")).toBeNull();
    expect(powSolved(null)).toBeNull();
    expect(powSolved(proof, Date.now() + 11 * 60_000)).toBeNull(); // abgelaufen
    // Aufgabe mit anderer Schwierigkeit lässt sich nicht fälschen (Signatur)
    const [body, sig] = c.token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), b: 1 })).toString("base64url");
    expect(powSolved(`${forged}.${sig}.0`)).toBeNull();
  });
});
