import { describe, expect, it } from "vitest";
import { adminNav } from "../../src/admin/nav";
import { badgeText, badgesFor, itemKeyFor } from "../../src/domain/unseen";

const hotel = { id: "h1", slug: "demo", primaryDomain: null };
const navs = { lodging: adminNav(hotel, new Set(), { area: "lodging" }), dining: adminNav(hotel, new Set(), { area: "dining" }) };

describe("Zahlen für Ungesehenes (SPEC 20.1)", () => {
  it("jede Art gehört zu einem Hauptpunkt ihres Bereichs", () => {
    expect(itemKeyFor("inbox", navs.lodging)).toBe("g-overview");
    expect(itemKeyFor("bookings", navs.lodging)).toBe("g-bookings");
    expect(itemKeyFor("reservations", navs.dining)).toBe("g-dining-res");
    expect(itemKeyFor("orders", navs.dining)).toBe("g-dining-orders");
  });

  it("Zahl je Menüpunkt und Bereich; 0 erscheint nicht", () => {
    const b = badgesFor({ inbox: 2, bookings: 1, reservations: 0, orders: 4 }, navs);
    expect(b.byItem).toEqual({ "g-overview": 2, "g-bookings": 1, "g-dining-orders": 4 });
    expect(b.byArea).toEqual({ lodging: 3, dining: 4 });
  });

  it("Seite nicht im Menü der Person: keine Zahl (Rolle, Modul), auch nicht im Bereich", () => {
    const b = badgesFor({ orders: 5, reservations: 2 }, { lodging: navs.lodging, dining: null });
    expect(b.byItem).toEqual({});
    expect(b.byArea).toEqual({ lodging: 0, dining: 0 });
    expect(itemKeyFor("bookings", { primary: navs.lodging.primary.filter((i) => i.key !== "g-bookings"), settings: navs.lodging.settings, account: navs.lodging.account })).toBeNull();
  });

  it("Anzeige: ab 100 «99+»", () => {
    expect(badgeText(7)).toBe("7");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });
});
