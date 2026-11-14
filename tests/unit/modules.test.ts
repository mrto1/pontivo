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
    const keys = new Set(allPages(adminNav(hotel, false)).map((i) => i.key));
    for (const m of MODULES) for (const k of m.navKeys) expect(keys.has(k), `${m.key}:${k}`).toBe(true);
  });
  it("ausgeschaltete Module verschwinden aus dem Menü, Sammelpunkt mit einem Reiter wird einfach", () => {
    const off = hiddenNavKeys([{ module: "frontdesk", enabled: false }, { module: "invoicing", enabled: false }]);
    const nav = adminNav(hotel, false, off);
    const keys = allPages(nav).map((i) => i.key);
    expect(keys).not.toEqual(expect.arrayContaining(["frontdesk"]));
    expect(keys).not.toEqual(expect.arrayContaining(["plan"]));
    expect(keys).not.toEqual(expect.arrayContaining(["invoices"]));
    const b = nav.primary.find((i) => i.key === "bookings")!;
    expect(b.tabs).toBeUndefined();
    // nur Rechnung aus: Buchungen behält Reiter Heute und Zimmerplan
    const nav2 = adminNav(hotel, false, hiddenNavKeys([{ module: "invoicing", enabled: false }]));
    expect(nav2.primary.find((i) => i.key === "bookings")!.tabs?.map((t) => t.key)).toEqual(["bookings", "frontdesk", "plan"]);
    expect(nav2.primary.length).toBeLessThanOrEqual(4);
  });
  it("Abhängigkeiten werden geprüft", () => {
    expect(switchProblem([], "unbekannt", true)).toMatch(/Unbekannt/);
    expect(switchProblem([], "frontdesk", false)).toBeNull();
  });
});
