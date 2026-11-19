import { describe, expect, it } from "vitest";
import { contrast, readableOnDark } from "../../src/domain/brand";
import { LAYOUTS, layoutOf } from "../../src/domain/theme";

describe("Nachtmodus der Hotel-Website (SPEC 19.26)", () => {
  it("Markenfarbe wird für dunklen Grund aufgehellt (mindestens 4.5:1), helle Farben bleiben", () => {
    for (const c of ["#1f4e79", "#0b1d3a", "#3e5c3a", "#5b3a6b", "#8a3b1f", "#000000"]) {
      expect(contrast(readableOnDark(c), "#14161a")).toBeGreaterThanOrEqual(4.5);
    }
    expect(readableOnDark("#ffd166")).toBe("#ffd166");
  });
  it("Alle Layouts bleiben wählbar, Standard ist «Ruhig»", () => {
    expect(LAYOUTS.map((l) => l.key)).toEqual(expect.arrayContaining(["klassisch", "panorama", "zentriert", "modern", "landhaus", "minimal", "redaktion", "galerie", "ruhig"]));
    expect(layoutOf(undefined)).toBe("ruhig");
    expect(layoutOf("klassisch")).toBe("klassisch");
  });
});
