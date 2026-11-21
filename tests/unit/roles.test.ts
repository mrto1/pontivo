import { describe, expect, it } from "vitest";
import { atLeast, canAccess, isLimitedRole, LANDING, ROLE_AREAS } from "../../src/domain/roles";
import { adminNav, allPages } from "../../src/admin/nav";
import { visibleNav } from "../../src/admin/visible-nav";

describe("Rollen (SPEC 17.4)", () => {
  it("volle Rollen wie bisher abgestuft", () => {
    expect(atLeast("owner", "manager")).toBe(true);
    expect(atLeast("staff", "manager")).toBe(false);
    expect(atLeast(null, "staff")).toBe(false);
    expect(canAccess("staff", "staff")).toBe(true);
    expect(canAccess("manager", "manager")).toBe(true);
  });

  it("eingeschränkte Rollen: ohne Bereich nie, nie über «staff» hinaus", () => {
    for (const r of ["reception", "housekeeping", "accounting", "service"] as const) {
      expect(isLimitedRole(r)).toBe(true);
      expect(atLeast(r, "staff")).toBe(false);
      expect(canAccess(r, "staff")).toBe(false); // Seite ohne Bereichsangabe = gesperrt
      expect(canAccess(r, "manager", "layout")).toBe(false);
      expect(canAccess(r, "staff", "settings")).toBe(false);
      expect(canAccess(r, "staff", "layout")).toBe(true);
      expect(ROLE_AREAS[r]).toContain(LANDING[r] === "" ? "tag" : LANDING[r] === "restaurant/heute" ? "dininghome" : LANDING[r]); // "" = Tag
    }
  });

  it("Bereiche je Rolle", () => {
    expect(canAccess("housekeeping", "staff", "housekeeping")).toBe(true);
    expect(canAccess("housekeeping", "staff", "bookings")).toBe(false);
    expect(canAccess("housekeeping", "staff", "invoices")).toBe(false);
    expect(canAccess("accounting", "staff", "invoices")).toBe(true);
    expect(canAccess("accounting", "staff", "statistics")).toBe(true);
    expect(canAccess("accounting", "staff", "bookings")).toBe(false);
    expect(canAccess("reception", "staff", "tag")).toBe(true);
    expect(canAccess("reception", "staff", "statistics")).toBe(false);
    expect(canAccess("reception", "staff", "settings")).toBe(false);
    expect(canAccess("reception", "staff", "report")).toBe(false);
    expect(canAccess("service", "staff", "restaurant")).toBe(true);
    expect(canAccess("service", "staff", "bookings")).toBe(false);
    expect(canAccess("service", "manager", "restaurant")).toBe(false); // Rabatt, Storno, Abschluss nur Manager
  });

  it("alle Bereiche der Rollen sind echte Menüpunkte (oder Rahmen)", () => {
    const hotel = { id: "h", slug: "s", primaryDomain: null };
    const keys = new Set<string>();
    const walk = (items: { key: string; tabs?: { key: string }[] }[]) => items.forEach((i) => { keys.add(i.key); walk(i.tabs ?? []); });
    for (const nav of [adminNav(hotel), adminNav(hotel, new Set(), { area: "dining" })]) { walk(nav.primary); walk(nav.settings.tabs ?? []); walk([nav.account]); }
    for (const areas of Object.values(ROLE_AREAS)) for (const a of areas) if (a !== "layout" && a !== "mypontivo" && a !== "tag") expect(keys.has(a), a).toBe(true);
  });
});

describe("Zahnrad und Menü je Rolle (SPEC 19.42)", () => {
  const hotel = { id: "h", slug: "s", primaryDomain: null };
  const none = new Set<string>();

  it("Zahnrad nur für Inhaber und Manager", () => {
    expect(visibleNav(hotel, "owner", none).showSettings).toBe(true);
    expect(visibleNav(hotel, "manager", none).showSettings).toBe(true);
    for (const r of ["staff", "reception", "housekeeping", "accounting", "service", "custom:Test:calendar"] as const) expect(visibleNav(hotel, r, none).showSettings, r).toBe(false);
  });

  it("Seite /einstellungen und Abo & Gebühren sind für Unberechtigte gesperrt", () => {
    // /einstellungen: requireHotel(…, "manager") ohne Bereich
    for (const r of ["staff", "reception", "housekeeping", "accounting", "service"] as const) expect(canAccess(r, "manager"), r).toBe(false);
    expect(canAccess("manager", "manager")).toBe(true);
    // Abo & Gebühren (report, plattform-rechnung): requireHotel(…, "owner")
    expect(canAccess("manager", "owner")).toBe(false);
    expect(canAccess("staff", "owner")).toBe(false);
    expect(canAccess("owner", "owner")).toBe(true);
    const keys = (r: "owner" | "manager") => allPages(visibleNav(hotel, r, none).nav).map((i) => i.key);
    expect(keys("owner")).toContain("report");
    expect(keys("manager")).not.toContain("report");
  });

  it("Rollen mit einer Seite sehen kein leeres Menü und landen direkt auf ihrer Seite", () => {
    for (const r of ["reception", "housekeeping", "accounting", "service"] as const) {
      const { nav } = visibleNav(hotel, r, none);
      const keys = allPages(nav).map((i) => i.key);
      expect(nav.primary.length, r).toBeGreaterThan(0);
      expect(keys, r).toContain(LANDING[r] === "" ? "home" : LANDING[r] === "restaurant/heute" ? "dininghome" : LANDING[r]);
      // «Tag» sehen nur Rollen mit Bereich «tag»; für die anderen leitet die Seite um und ein Reiter wäre tot
      expect(keys.includes("home"), r).toBe(ROLE_AREAS[r].includes("tag"));
      expect(keys.every((k) => ROLE_AREAS[r].includes(k) || ["mypontivo", "firstweek", "help", "helpflows", "helpterms"].includes(k)), r).toBe(true);
      expect(nav.settings.tabs, r).toEqual([]);
    }
    // Rezeption landet auf der Tagesliste, dem ersten Reiter von «Heute», zusammen mit Reinigung und Posteingang
    const rc = visibleNav(hotel, "reception", none).nav;
    expect(rc.primary[0].tabs!.map((t) => t.key)).toEqual(["home", "inbox", "housekeeping"]);
    // Reinigung: nur ein Hauptpunkt, der direkt zur Reinigung führt
    const h = visibleNav(hotel, "housekeeping", none).nav;
    expect(h.primary).toHaveLength(1);
    expect(h.primary[0].href).toBe("/admin/h/housekeeping");
    // Service: Restaurant mit Tische und Kasse
    const s = visibleNav(hotel, "service", new Set(["posclose"])).nav;
    expect(allPages(s).map((i) => i.key).filter((k) => ["restaurant", "kasse"].includes(k))).toEqual(["restaurant", "kasse"]);
  });

  it("Umschalter (SPEC 20.1): nur Unterkunft mit Gastronomie und nur, wer beide Bereiche sieht", () => {
    const on = new Set<string>(); // keine ausgeblendeten Module = restaurant an
    const off = new Set(["dininghome", "reservations", "resplan", "waitlist", "kitchen", "positems", "ressettings", "restaurant", "kasse", "posdevices", "posclose"]);
    expect(visibleNav(hotel, "owner", on).showSwitch).toBe(true);
    expect(visibleNav(hotel, "owner", off).showSwitch).toBe(false);
    expect(visibleNav(hotel, "owner", off).navs.dining).toBeNull();
    // Service sieht nur die Gastronomie: kein Umschalter, Menü des Restaurants
    const sv = visibleNav(hotel, "service", on);
    expect(sv.showSwitch).toBe(false);
    expect(sv.nav.primary.map((i) => i.label)).toEqual(["Heute", "Reservierungen", "Bestellungen"]);
    expect(visibleNav(hotel, "reception", on).showSwitch).toBe(false);
    // Reines Restaurant: nur der Restaurant-Baum, ohne Umschalter
    const r = visibleNav({ ...hotel, propertyType: "restaurant" }, "owner", on);
    expect(r.showSwitch).toBe(false);
    expect(r.navs.lodging).toBeNull();
    expect(r.nav.primary.map((i) => i.label)).toEqual(["Heute", "Reservierungen", "Bestellungen", "Finanzen"]);
    // gewählter Bereich wird übernommen
    expect(visibleNav(hotel, "owner", on, "dining").nav.primary[1].label).toBe("Reservierungen");
    expect(visibleNav(hotel, "owner", on, "lodging").nav.primary[1].label).toBe("Kalender");
  });
});
