import { describe, expect, it } from "vitest";
import { hiddenNavKeys, isOn, MODULES, switchProblem } from "../../src/domain/modules";
import { adminNav, allPages } from "../../src/admin/nav";

const hotel = { id: "h1", slug: "demo", primaryDomain: null };

describe("Modul-Register", () => {
  it("ohne Zeile gilt der Standard; Zeile überschreibt; unbekannte Module sind aus", () => {
    expect(isOn([], "frontdesk")).toBe(true);
    expect(isOn([{ module: "frontdesk", enabled: false }], "frontdesk")).toBe(false);
    expect(isOn([], "gibt-es-nicht")).toBe(false);
  });
  it("jeder Menüschlüssel der Module existiert im Menü", () => {
    const keys = new Set(allPages(adminNav(hotel)).map((i) => i.key));
    for (const m of MODULES) for (const k of m.navKeys) expect(keys.has(k), `${m.key}:${k}`).toBe(true);
  });
  it("ausgeschaltete Module verschwinden aus dem Menü, Gruppe mit einem Reiter wird einfach", () => {
    const off = hiddenNavKeys([{ module: "frontdesk", enabled: false }, { module: "invoicing", enabled: false }]);
    const nav = adminNav(hotel, off);
    const keys = allPages(nav).map((i) => i.key);
    for (const k of ["frontdesk", "plan", "invoices", "dayclose"]) expect(keys).not.toContain(k);
    const cal = nav.primary.find((i) => i.icon === "calendar")!;
    // ohne Rezeption (und ohne Preisempfehlung): Kalender ist nur noch Preise & Verfügbarkeit, ohne Reiter
    expect(cal.tabs).toBeUndefined();
    expect(cal.key).toBe("calendar");
    expect(cal.href).toBe("/mypontivo/h1/calendar");
    // Finanzen ohne Rechnung & Kasse: Debitoren braucht sie ebenfalls; übrig Eigentümer, Statistik, Buchhaltung
    const fin = nav.primary.find((i) => i.icon === "finance")!;
    expect(fin.tabs?.map((t) => t.key)).not.toContain("invoices");
    expect(nav.primary.length).toBeLessThanOrEqual(4);
  });
  it("Zahnrad: ausgeschaltete Module verschwinden auch dort, Gruppen ohne Punkte fehlen", () => {
    const off = hiddenNavKeys([{ module: "terminal", enabled: false }, { module: "access", enabled: false }, { module: "pos", enabled: false }, { module: "posbridge", enabled: false }, { module: "invoicing", enabled: false }]);
    const keys = allPages(adminNav(hotel, off)).map((i) => i.key);
    for (const k of ["terminal", "access", "positems", "posbridge"]) expect(keys).not.toContain(k);
    expect(keys).toContain("funktionen");
  });
  it("Abhängigkeiten werden geprüft", () => {
    expect(switchProblem([], "unbekannt", true)).toMatch(/Unbekannt/);
    expect(switchProblem([], "frontdesk", false)).toBeNull();
  });
});
