import { describe, expect, it } from "vitest";
import { applyMailGuard } from "../../src/lib/environment";

const msg = { from: "a@pontivo.ch", to: "gast@example.ch", subject: "Bestätigung", html: "<p>Hallo</p>", text: "Hallo" };

describe("Mail-Schutz der Testumgebung", () => {
  it("ohne Umleitung unverändert", () => expect(applyMailGuard(msg, undefined)).toBe(msg));
  it("leitet um und nennt den ursprünglichen Empfänger", () => {
    const r = applyMailGuard(msg, "test@pontivo.ch");
    expect(r.to).toBe("test@pontivo.ch");
    expect(r.subject).toContain("gast@example.ch");
    expect(r.text).toContain("gast@example.ch");
    expect(r.html).toContain("gast@example.ch");
  });
  it("Mail an die Testadresse selbst bleibt unverändert", () => expect(applyMailGuard({ ...msg, to: "Test@pontivo.ch" }, "test@pontivo.ch").subject).toBe("Bestätigung"));
});
