import { describe, expect, it } from "vitest";
import { checkGuard, issueGuardToken, MIN_FILL_MS } from "../../src/lib/form-guard";
import { isDisposableEmail } from "../../src/domain/disposable-email";

describe("Formular-Schutz (Honeypot, Mindestzeit)", () => {
  const t0 = 1_700_000_000_000;
  it("lässt ein normal ausgefülltes Formular durch", () => {
    expect(checkGuard({ honeypot: "", token: issueGuardToken(t0) }, t0 + MIN_FILL_MS + 1)).toEqual({ ok: true });
  });
  it("blockt zu schnelles Absenden, ausgefüllten Honeypot, fehlendes oder gefälschtes Token, abgelaufenes Token", () => {
    const tok = issueGuardToken(t0);
    expect(checkGuard({ token: tok }, t0 + 500)).toEqual({ ok: false, reason: "too_fast" });
    expect(checkGuard({ honeypot: "http://spam", token: tok }, t0 + 10_000)).toEqual({ ok: false, reason: "honeypot" });
    expect(checkGuard({}, t0 + 10_000)).toEqual({ ok: false, reason: "token" });
    expect(checkGuard({ token: tok.replace(/.$/, "x") }, t0 + 10_000)).toEqual({ ok: false, reason: "token" });
    expect(checkGuard({ token: tok }, t0 + 3 * 3600_000)).toEqual({ ok: false, reason: "token" });
  });
});

describe("Wegwerf-Adressen", () => {
  it("sperrt bekannte Anbieter und deren Unterdomains, lässt normale Adressen zu", () => {
    expect(isDisposableEmail("a@mailinator.com")).toBe(true);
    expect(isDisposableEmail("A@Mailinator.COM")).toBe(true);
    expect(isDisposableEmail("a@x.mailinator.com")).toBe(true);
    expect(isDisposableEmail("a@pontivo-test-blocked.invalid")).toBe(true);
    for (const ok of ["ruth@gmail.com", "info@hotel-alpenrose.ch", "x@bluewin.ch", "kein-at-zeichen"]) expect(isDisposableEmail(ok)).toBe(false);
  });
});
