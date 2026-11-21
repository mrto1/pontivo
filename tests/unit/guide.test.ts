import { describe, expect, it } from "vitest";
import { GUIDE, HELP_START, guideRole, progress, tasksFor } from "../../src/domain/guide";
import { ROLE_AREAS, type LimitedRole } from "../../src/domain/roles";
import { MODULES } from "../../src/domain/modules";
import { adminNav, allPages } from "../../src/admin/nav";

const nav = allPages(adminNav({ id: "h", slug: "s", primaryDomain: null }));
const keys = new Set([...nav.map((p) => p.key), "mypontivo"]);

describe("Einarbeitung (PMS-ERSATZ 4.2)", () => {
  it("5 bis 8 Aufgaben je Rolle (Housekeeping kurz), eindeutige Schlüssel", () => {
    const all = Object.values(GUIDE).flat().map((t) => t.key);
    expect(new Set(all).size).toBe(all.length);
    for (const [r, list] of Object.entries(GUIDE)) expect(list.length, r).toBeGreaterThanOrEqual(r === "housekeeping" ? 4 : 5);
    for (const list of Object.values(GUIDE)) expect(list.length).toBeLessThanOrEqual(8);
  });
  it("jede Aufgabe zeigt auf einen echten Menüpunkt", () => {
    for (const t of Object.values(GUIDE).flat()) expect(keys.has(t.area), `${t.key}: ${t.area}`).toBe(true);
  });
  it("eingeschränkte Rollen bekommen nur Aufgaben in ihren Bereichen", () => {
    for (const r of ["reception", "housekeeping", "accounting", "service"] as LimitedRole[]) {
      for (const t of GUIDE[r]) expect(ROLE_AREAS[r].includes(t.area), `${r}: ${t.key} → ${t.area}`).toBe(true);
      expect(ROLE_AREAS[r]).toContain("firstweek");
      expect(ROLE_AREAS[r]).toContain("help");
    }
  });
  it("ausgeschaltete Funktionen entfallen, Rolle wählt die Liste", () => {
    expect(guideRole("manager")).toBe("owner");
    expect(guideRole("staff")).toBe("owner");
    expect(guideRole("service")).toBe("service");
    const without = tasksFor("reception", new Set(["home", "bookings"]));
    expect(without.every((t) => ["home", "bookings"].includes(t.area))).toBe(true);
    expect(without.length).toBeLessThan(GUIDE.reception.length);
  });
  it("Fortschritt", () => {
    const t = GUIDE.service;
    expect(progress(t, new Set([t[0].key, "fremd"]))).toEqual({ done: 1, total: t.length });
  });
  it("Hilfetexte gehören zu echten Funktionen", () => {
    for (const k of Object.keys(HELP_START)) expect(MODULES.some((m) => m.key === k), k).toBe(true);
  });
});
