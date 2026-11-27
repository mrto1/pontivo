import { describe, expect, it } from "vitest";
import { MODULE_KEYS, isOn } from "../../src/domain/modules";
import { PACKAGES, packageState, packagesFor, wantedForToggle, wantedFromPackages } from "../../src/domain/packages";

describe("Funktionspakete (SPEC 19.69)", () => {
  it("bestehen nur aus echten Funktionen", () => {
    for (const p of PACKAGES) for (const m of p.modules) expect(MODULE_KEYS).toContain(m);
  });
  it("je Betriebsart: Restaurant ohne Unterkunftspakete, Hotel ohne Eigentümerabrechnung", () => {
    const resto = packagesFor({ restaurantOnly: true, wholeUnit: false }).map((p) => p.key);
    expect(resto).not.toContain("basis");
    expect(resto).toContain("restaurant");
    expect(packagesFor({ restaurantOnly: true, wholeUnit: false }).find((p) => p.key === "wachstum")!.modules).not.toContain("pricing_rules");
    expect(packagesFor({ restaurantOnly: false, wholeUnit: false }).map((p) => p.key)).not.toContain("vermietung");
    expect(packagesFor({ restaurantOnly: false, wholeUnit: true }).map((p) => p.key)).toContain("vermietung");
  });
  it("Auswahl: gewählte an, nicht gewählte aus, geteilte Funktionen bleiben an", () => {
    const shown = packagesFor({ restaurantOnly: false, wholeUnit: false });
    const w = wantedFromPackages(shown, ["basis", "restaurant"]);
    expect(w.invoicing).toBe(true);
    expect(w.restaurant).toBe(true);
    expect(w.frontdesk).toBe(false);
    expect(w.google).toBe(true); // in «basis» und «wachstum»: gewählt über basis
    expect(w.pos).toBe(false);
  });
  it("Stand und Ausschalten mit Rücksicht auf andere Pakete", () => {
    const shown = packagesFor({ restaurantOnly: false, wholeUnit: false });
    const rows = MODULE_KEYS.map((k) => ({ module: k, enabled: ["restaurant", "pos", "guestnotes"].includes(k) }));
    const resto = shown.find((p) => p.key === "restaurant")!;
    expect(packageState(resto, rows, isOn)).toBe("on");
    expect(packageState(shown.find((p) => p.key === "betrieb")!, rows, isOn)).toBe("partial");
    // «Restaurant» aus, «Kasse» bleibt ganz an → restaurant bleibt an, guestnotes geht aus
    expect(wantedForToggle(shown, "restaurant", false, rows, isOn)).toEqual({ guestnotes: false });
  });
});
