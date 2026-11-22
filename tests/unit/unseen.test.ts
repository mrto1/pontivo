import { describe, expect, it } from "vitest";
import { adminNav } from "../../src/admin/nav";
import { badgeText, badgesFor, badgeView, itemKeyFor } from "../../src/domain/unseen";

const hotel = { id: "h1", slug: "demo", primaryDomain: null };
const navs = { lodging: adminNav(hotel, new Set(), { area: "lodging" }), dining: adminNav(hotel, new Set(), { area: "dining" }) };

describe("Zahlen für Ungesehenes (SPEC 20.1)", () => {
  it("jede Art gehört zu einem Hauptpunkt ihres Bereichs", () => {
    expect(itemKeyFor("inbox", navs.lodging)).toBe("g-overview");
    expect(itemKeyFor("bookings", navs.lodging)).toBe("g-bookings");
    expect(itemKeyFor("reservations", navs.dining)).toBe("g-dining-res");
    expect(itemKeyFor("orders", navs.dining)).toBe("g-dining-orders");
  });

  it("Zahl je Menüpunkt und Bereich: neu (Person) und offen (Team) getrennt; 0 erscheint nicht", () => {
    const b = badgesFor({ inbox: 2, bookings: 1, reservations: 0, orders: 4 }, { inbox: 5, orders: 1, overdue: 3 }, navs);
    expect(b.byItem).toEqual({
      "g-overview": { fresh: 2, open: 5 },
      "g-bookings": { fresh: 1, open: 0 },
      "g-dining-orders": { fresh: 4, open: 1 },
      "g-finance": { fresh: 0, open: 3 },
    });
    expect(b.byArea).toEqual({ lodging: { fresh: 3, open: 8 }, dining: { fresh: 4, open: 1 } });
  });

  it("Anzeige: «neu» hat Vorrang vor «offen»; ohne beides nichts", () => {
    expect(badgeView({ fresh: 2, open: 5 })).toEqual({ n: 2, tone: "fresh", label: "2 neu, 5 offen" });
    expect(badgeView({ fresh: 0, open: 3 })).toEqual({ n: 3, tone: "open", label: "3 offen" });
    expect(badgeView({ fresh: 0, open: 0 })).toBeNull();
    expect(badgeView(undefined)).toBeNull();
  });

  it("Seite nicht im Menü der Person: keine Zahl (Rolle, Modul), auch nicht im Bereich", () => {
    const b = badgesFor({ orders: 5, reservations: 2 }, { orders: 2 }, { lodging: navs.lodging, dining: null });
    expect(b.byItem).toEqual({});
    expect(b.byArea).toEqual({ lodging: { fresh: 0, open: 0 }, dining: { fresh: 0, open: 0 } });
    expect(itemKeyFor("bookings", { primary: navs.lodging.primary.filter((i) => i.key !== "g-bookings"), settings: navs.lodging.settings, account: navs.lodging.account })).toBeNull();
  });

  it("Anzeige: ab 100 «99+»", () => {
    expect(badgeText(7)).toBe("7");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });
});
