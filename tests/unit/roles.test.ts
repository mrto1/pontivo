import { describe, expect, it } from "vitest";
import { atLeast, canAccess, isLimitedRole, LANDING, ROLE_AREAS } from "../../src/domain/roles";
import { adminNav } from "../../src/admin/nav";

describe("Rollen (SPEC 17.4)", () => {
  it("volle Rollen wie bisher abgestuft", () => {
    expect(atLeast("owner", "manager")).toBe(true);
    expect(atLeast("staff", "manager")).toBe(false);
    expect(atLeast(null, "staff")).toBe(false);
    expect(canAccess("staff", "staff")).toBe(true);
    expect(canAccess("manager", "manager")).toBe(true);
  });

  it("eingeschränkte Rollen: ohne Bereich nie, nie über «staff» hinaus", () => {
    for (const r of ["reception", "housekeeping", "accounting"] as const) {
      expect(isLimitedRole(r)).toBe(true);
      expect(atLeast(r, "staff")).toBe(false);
      expect(canAccess(r, "staff")).toBe(false); // Seite ohne Bereichsangabe = gesperrt
      expect(canAccess(r, "manager", "layout")).toBe(false);
      expect(canAccess(r, "staff", "settings")).toBe(false);
      expect(canAccess(r, "staff", "layout")).toBe(true);
      expect(ROLE_AREAS[r]).toContain(LANDING[r]);
    }
  });

  it("Bereiche je Rolle", () => {
    expect(canAccess("housekeeping", "staff", "housekeeping")).toBe(true);
    expect(canAccess("housekeeping", "staff", "bookings")).toBe(false);
    expect(canAccess("housekeeping", "staff", "invoices")).toBe(false);
    expect(canAccess("accounting", "staff", "invoices")).toBe(true);
    expect(canAccess("accounting", "staff", "statistics")).toBe(true);
    expect(canAccess("accounting", "staff", "bookings")).toBe(false);
    expect(canAccess("reception", "staff", "frontdesk")).toBe(true);
    expect(canAccess("reception", "staff", "statistics")).toBe(false);
    expect(canAccess("reception", "staff", "settings")).toBe(false);
    expect(canAccess("reception", "staff", "report")).toBe(false);
  });

  it("alle Bereiche der Rollen sind echte Menüpunkte (oder Rahmen)", () => {
    const hotel = { id: "h", slug: "s", primaryDomain: null };
    const nav = adminNav(hotel, false);
    const keys = new Set<string>();
    const walk = (items: { key: string; tabs?: { key: string }[] }[]) => items.forEach((i) => { keys.add(i.key); walk(i.tabs ?? []); });
    walk(nav.primary); nav.groups.forEach((g) => walk(g.items));
    for (const areas of Object.values(ROLE_AREAS)) for (const a of areas) if (a !== "layout") expect(keys.has(a), a).toBe(true);
  });
});
