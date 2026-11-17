import { describe, expect, it } from "vitest";
import { MAX_ROOMS, suitability } from "../../src/domain/suitability";

describe("Eignungs-Check (SPEC 19.14)", () => {
  it("kleines Haus ohne Restaurant passt", () => {
    const r = suitability({ rooms: 12, restaurantWithPos: false, software: "small" });
    expect(r.fit).toBe("fits");
    expect(r.text).toContain("Datenübernahme"); // verspricht nur den CSV-Import
    expect(suitability({ rooms: 5, restaurantWithPos: false, software: "none" }).text).toContain("ohne Datenübernahme");
  });
  it("Restaurant mit Kasse: Schnittstelle und Kassenmodul, ehrlich über Grenzen", () => {
    const r = suitability({ rooms: 20, restaurantWithPos: true, software: "channel" });
    expect(r.fit).toBe("with_pos");
    expect(r.text).toContain("Kassen-Schnittstelle");
    expect(r.text).toContain("Treuhänder"); // Kassenmodul noch nicht vom Treuhänder bestätigt
    expect(r.text).toContain("noch nicht"); // kein Drucker, kein Terminal
  });
  it("zu gross oder Grosssoftware: läuft daneben, auch mit Restaurant", () => {
    expect(suitability({ rooms: MAX_ROOMS + 1, restaurantWithPos: false, software: "none" }).fit).toBe("alongside");
    expect(suitability({ rooms: MAX_ROOMS, restaurantWithPos: false, software: "none" }).fit).toBe("fits");
    const r = suitability({ rooms: 10, restaurantWithPos: true, software: "large" });
    expect(r.fit).toBe("alongside");
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});
