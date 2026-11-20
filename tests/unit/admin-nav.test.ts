import { describe, expect, it } from "vitest";
import { adminNav, allPages, bestMatch, isActive, sectionFor } from "../../src/admin/nav";
import { GET as manifest } from "../../app/mypontivo/manifest.webmanifest/route";
import { GET as sw } from "../../app/mypontivo/sw.js/route";
import { GET as icon } from "../../app/mypontivo/pwa-icon/[size]/route";

const hotel = { id: "h1", slug: "demo", primaryDomain: null };

describe("Admin-Menü", () => {
  it("jede Seite genau einmal; alle Links gehören zum eigenen Hotel", () => {
    const nav = adminNav(hotel);
    const all = allPages(nav);
    const keys = all.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const i of all) expect(i.href.startsWith("/mypontivo/h1")).toBe(true);
    expect(nav.primary.length).toBeLessThanOrEqual(4); // passt in die untere Leiste, kein «Mehr»
    expect(nav.primary.map((i) => i.label)).toEqual(["Mein Betrieb", "Kalender", "Buchungen", "Gäste"]);
    expect(keys).toEqual(expect.arrayContaining(["home", "calendar", "plan", "pricing", "channex", "ical", "bookings", "report", "guests", "inbox", "vouchers", "rooms", "site", "api", "team", "settings", "funktionen", "terminal", "access", "posbridge", "migration", "firstweek", "help"]));
    expect(keys).not.toContain("embed");
    expect(keys).not.toContain("inquiries");
  });

  it("Kalender, Buchungen und Gäste haben Reiter, Trenner trennen Gruppen", () => {
    const nav = adminNav(hotel);
    const tabs = (k: string) => nav.primary.find((i) => i.key === k)!.tabs!;
    expect(tabs("calendar").map((t) => t.key)).toEqual(["calendar", "plan", "pricing", "channex", "ical"]);
    expect(tabs("bookings").map((t) => t.key)).not.toContain("plan");
    expect(tabs("guests").map((t) => t.key)).toEqual(["guests", "guestbook", "inbox", "marketing", "vouchers", "feedback", "ki-chat", "upsell", "mailtexts"]);
    expect(tabs("guests").filter((t) => t.sep).map((t) => t.key)).toEqual(["inbox", "ki-chat"]);
    expect(tabs("guests")[0].label).toBe("Check-in");
  });

  it("«Mein Betrieb» enthält Reiter mit zweiter Reihe", () => {
    const nav = adminNav(hotel);
    const home = "/mypontivo/h1";
    const overview = nav.primary[0];
    expect(overview.tabs!.map((t) => t.label)).toEqual(["Übersicht", "Zimmer und Tarife", "Website und Buchung", "Team", "Einstellungen", "Statistik", "Buchhaltung", "Restaurant"]);
    expect(sectionFor("/mypontivo/h1/rooms", nav, home)?.label).toBe("Mein Betrieb");
    expect(sectionFor("/mypontivo/h1/site/blocks", nav, home)?.label).toBe("Mein Betrieb");
    expect(sectionFor("/mypontivo/h1/zutritt", nav, home)?.label).toBe("Mein Betrieb");
    expect(sectionFor("/mypontivo/h1/channex/booking", nav, home)?.label).toBe("Kalender");
    expect(sectionFor("/mypontivo/h1/preise", nav, home)?.label).toBe("Kalender");
    expect(sectionFor("/mypontivo/h1/inbox", nav, home)?.label).toBe("Gäste");
    expect(sectionFor("/mypontivo/h1/hilfe", nav, home)?.label).toBe("Mein Konto");
    expect(sectionFor("/mypontivo/h1/mypontivo", nav, home)?.label).toBe("Mein Konto");
    expect(isActive("/mypontivo/h1/vouchers", nav.primary[3], home)).toBe(true); // Reiter hält den Sammelpunkt aktiv
    expect(isActive("/mypontivo/h1/zutritt", overview, home)).toBe(true);
    expect(bestMatch("/mypontivo/h1/invoices/tagesabschluss", nav.primary[2], home)).toBeGreaterThan(bestMatch("/mypontivo/h1/invoices/tagesabschluss", { key: "x", label: "x", href: "/mypontivo/h1/invoices" }, home));
  });

  it("Das Menü ist immer vollständig: kein «Einrichten»-Punkt, Konto über den Avatar", () => {
    const nav = adminNav(hotel);
    expect(allPages(nav).map((i) => i.key)).not.toContain("einrichten");
    expect(nav.account.href).toBe("/mypontivo/h1/mypontivo");
  });

  it("aktive Seite: Übersicht nur exakt, andere auch bei Unterseiten", () => {
    const nav = adminNav(hotel);
    const home = "/mypontivo/h1";
    const [overview, calendar] = nav.primary;
    expect(isActive("/mypontivo/h1", overview, home)).toBe(true);
    expect(isActive("/mypontivo/h1/calendar", overview, home)).toBe(false);
    expect(isActive("/mypontivo/h1/calendar/x", calendar, home)).toBe(true);
    expect(isActive("/mypontivo/h1/calendarium", calendar, home)).toBe(false);
  });
});

describe("PWA", () => {
  it("Manifest nur für /mypontivo, mit 192er und 512er Icon", async () => {
    const m = await manifest().json();
    expect(m).toMatchObject({ start_url: "/mypontivo", scope: "/mypontivo/", display: "standalone" });
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("Service Worker: Geltungsbereich /mypontivo, nichts ausser der Offline-Seite wird gespeichert", async () => {
    const res = sw();
    expect(res.headers.get("Service-Worker-Allowed")).toBe("/mypontivo/");
    const js = await res.text();
    expect(js).toContain('"/mypontivo/offline"');
    expect(js).toContain('startsWith("/mypontivo")');
    expect(js).not.toMatch(/cache\.put|addAll/);
  });

  it("Icons sind PNG; unbekannte Grösse → 404", async () => {
    const ok = await icon(new Request("http://x"), { params: Promise.resolve({ size: "192" }) });
    expect(ok.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await ok.arrayBuffer()).slice(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));
    expect((await icon(new Request("http://x"), { params: Promise.resolve({ size: "7" }) })).status).toBe(404);
  });
});
