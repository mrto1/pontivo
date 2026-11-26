import { describe, expect, it } from "vitest";
import { isUuid } from "../../src/lib/uuid";

describe("isUuid (Pfadteile vor der DB-Abfrage prüfen)", () => {
  it("erkennt gültige und ungültige Werte", () => {
    expect(isUuid("45a7035d-11a1-4941-8247-98371bedd023")).toBe(true);
    expect(isUuid("45A7035D-11A1-4941-8247-98371BEDD023")).toBe(true);
    for (const x of ["registrieren", "", "45a7035d11a1494182479837", "45a7035d-11a1-4941-8247-98371bedd023x", null, 3]) expect(isUuid(x)).toBe(false);
  });
});
