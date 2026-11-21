import { describe, expect, it } from "vitest";
import { adminNav, allPages, bestMatch, inSettings, isActive, leafKeys, sectionFor, settingsGroups } from "../../src/admin/nav";
import { hiddenNavKeys } from "../../src/domain/modules";
import { GET as manifest } from "../../app/mypontivo/manifest.webmanifest/route";
import { GET as sw } from "../../app/mypontivo/sw.js/route";
import { GET as icon } from "../../app/mypontivo/pwa-icon/[size]/route";

const hotel = { id: "h1", slug: "demo", primaryDomain: null };

describe("Admin-Menü", () => {
  const nav = adminNav(hotel);
  const home = "/mypontivo/h1";
  const group = (label: string) => nav.primary.find((i) => i.label === label)!;
  const tabKeys = (label: string) => group(label).tabs!.map((t) => t.key);

  it("vier Hauptpunkte, Zahnrad und Profil; jede Seite genau einmal; alle Links gehören zum Hotel", () => {
    const all = allPages(nav);
    const keys = all.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const i of all) expect(i.href.startsWith("/mypontivo/h1")).toBe(true);
    expect(nav.primary.map((i) => i.label)).toEqual(["Heute", "Kalender", "Buchungen", "Finanzen"]);
    expect(nav.settings.href).toBe("/mypontivo/h1/einstellungen");
    expect(nav.account.href).toBe("/mypontivo/h1/mypontivo");
    expect(keys).not.toContain("embed");
    expect(keys).not.toContain("inquiries");
    expect(keys).not.toContain("einrichten");
  });

  it("Seitenschlüssel und Adressen bleiben wie bisher", () => {
    const byKey = Object.fromEntries(allPages(nav).map((i) => [i.key, i.href.replace("/mypontivo/h1/", "")]));
    expect(byKey).toMatchObject({
      home: "/mypontivo/h1", housekeeping: "housekeeping", inbox: "inbox", restaurant: "restaurant", kasse: "kasse", posclose: "restaurant/abschluss", plan: "plan", calendar: "calendar", pricing: "preise",
      bookings: "bookings", groups: "groups", resources: "resources", vouchers: "vouchers", guestbook: "guestbook", marketing: "marketing", feedback: "feedback",
      invoices: "invoices", dayclose: "invoices/tagesabschluss", debtors: "invoices/debitoren", owners: "owners", statistics: "statistics", hesta: "statistics/hesta", accountingexport: "buchhaltung", reports: "berichte",
      settings: "settings", rooms: "rooms", extras: "rooms/extras", team: "team", site: "site", direct: "direktbuchung", api: "api", channex: "channex", ical: "ical", mailtexts: "mail-texte", upsell: "upsell", "ki-chat": "ki-chat",
      funktionen: "funktionen", terminal: "terminal", access: "zutritt", positems: "restaurant/artikel", posbridge: "posbridge", migration: "migration", report: "report", mypontivo: "mypontivo", firstweek: "erste-woche", help: "hilfe",
    });
  });

  it("Reiter der Hauptpunkte", () => {
    expect(tabKeys("Heute")).toEqual(["home", "housekeeping", "inbox", "g-restaurant"]);
    expect(group("Heute").tabs![0].label).toBe("Tagesliste");
    expect(group("Heute").tabs![3].tabs!.map((t) => t.key)).toEqual(["restaurant", "kasse", "posclose"]);
    expect(tabKeys("Kalender")).toEqual(["plan", "calendar", "pricing"]);
    expect(tabKeys("Buchungen")).toEqual(["bookings", "groups", "resources", "vouchers", "g-guests"]);
    expect(group("Buchungen").tabs![4].tabs!.map((t) => t.key)).toEqual(["guestbook", "marketing", "feedback"]);
    expect(tabKeys("Finanzen")).toEqual(["invoices", "dayclose", "debtors", "owners", "g-statistics", "reports", "accountingexport"]);
    expect(group("Finanzen").tabs![4].tabs!.map((t) => t.key)).toEqual(["statistics", "hesta"]);
  });

  it("Zahnrad: drei Gruppen mit je einem Satz Erklärung", () => {
    const groups = settingsGroups(nav);
    expect(groups.map((g) => g.title)).toEqual(["Betrieb", "Verkauf", "Technik"]);
    expect(groups.map((g) => g.items.map((i) => i.label))).toEqual([
      ["Grunddaten", "Zimmer & Tarife", "Zusatzleistungen", "Team & Rollen"],
      ["Website & Buchung", "Kanäle", "Gäste-Mails", "Gästeportal", "Upselling", "KI-Chat"],
      ["Funktionen", "Geräte & Kasse", "Datenübernahme", "Abo & Gebühren"],
    ]);
    for (const g of groups) { expect(g.lead.length).toBeGreaterThan(10); for (const i of g.items) expect(i.lead, i.label).toBeTruthy(); }
    expect(nav.settings.tabs!.find((i) => i.label === "Website & Buchung")!.tabs!.map((t) => t.key)).toEqual(["site", "direct", "api"]);
    expect(nav.settings.tabs!.find((i) => i.label === "Kanäle")!.tabs!.map((t) => t.key)).toEqual(["channex", "ical"]);
    expect(nav.settings.tabs!.find((i) => i.label === "Geräte & Kasse")!.tabs!.map((t) => t.key)).toEqual(["terminal", "access", "positems", "posbridge"]);
  });

  it("Kalender startet mit dem Zimmerplan, wenn die Rezeption an ist, sonst mit Preise & Verfügbarkeit", () => {
    expect(group("Kalender").href).toBe("/mypontivo/h1/plan");
    const off = adminNav(hotel, new Set(["plan"]));
    const cal = off.primary.find((i) => i.label === "Kalender")!;
    expect(cal.tabs![0].key).toBe("calendar");
    expect(cal.href).toBe("/mypontivo/h1/calendar");
  });

  it("Restaurant-Reiter nur mit eingeschaltetem Modul pos", () => {
    const withPos = allPages(adminNav(hotel, hiddenNavKeys([{ module: "pos", enabled: true }]))).map((i) => i.key);
    const without = allPages(adminNav(hotel, hiddenNavKeys([]))).map((i) => i.key);
    expect(withPos).toEqual(expect.arrayContaining(["restaurant", "kasse", "posclose"]));
    // pos ist von Haus aus aus
    expect(without).not.toContain("restaurant");
    expect(without).not.toContain("kasse");
    expect(without).not.toContain("posclose");
  });

  it("Ferienwohnung mit Grundausstattung: Heute (nur Tagesliste und Posteingang), Kalender, Buchungen, Finanzen", () => {
    const off = hiddenNavKeys([{ module: "frontdesk", enabled: false }]);
    const n = adminNav(hotel, off);
    expect(n.primary.map((i) => i.label)).toEqual(["Heute", "Kalender", "Buchungen", "Finanzen"]);
    expect(allPages(n).map((i) => i.key)).not.toContain("plan");
    expect(allPages(n).map((i) => i.key)).not.toContain("frontdesk"); // Seite gibt es nicht mehr
    expect(n.primary[0].href).toBe("/mypontivo/h1");
  });

  it("Gruppen verschwinden ganz, wenn alle Seiten fehlen; Zahnrad bleibt erreichbar", () => {
    const all = new Set(leafKeys(nav).filter((k) => !["home"].includes(k)));
    const n = adminNav(hotel, all);
    expect(n.primary.map((i) => i.label)).toEqual(["Heute"]);
    expect(n.settings.href).toBe("/mypontivo/h1/einstellungen");
    expect(n.settings.tabs).toEqual([]);
  });

  it("Reiter über der Seite und Aktivzustand", () => {
    expect(sectionFor(`${home}/rooms`, nav, home)).toBeNull(); // Zahnrad-Punkt ohne Unterreiter
    expect(sectionFor(`${home}/site/blocks`, nav, home)?.label).toBe("Website & Buchung");
    expect(sectionFor(`${home}/channex/booking`, nav, home)?.label).toBe("Kanäle");
    expect(sectionFor(`${home}/zutritt`, nav, home)?.label).toBe("Geräte & Kasse");
    expect(sectionFor(`${home}/preise`, nav, home)?.label).toBe("Kalender");
    expect(sectionFor(`${home}/inbox`, nav, home)?.label).toBe("Heute");
    expect(sectionFor(`${home}/guestbook`, nav, home)?.label).toBe("Buchungen");
    expect(sectionFor(`${home}/hilfe`, nav, home)?.label).toBe("Mein Konto");
    expect(sectionFor(`${home}/einstellungen`, nav, home)).toBeNull();
    expect(inSettings(`${home}/einstellungen`, nav, home)).toBe(true);
    expect(inSettings(`${home}/rooms`, nav, home)).toBe(true);
    expect(inSettings(`${home}/bookings`, nav, home)).toBe(false);
    // Detailseiten der Plattform-Rechnung gehören zu «Abo & Gebühren»
    expect(inSettings(`${home}/plattform-rechnung/abc`, nav, home)).toBe(true);
    expect(isActive(`${home}/vouchers`, group("Buchungen"), home)).toBe(true);
    expect(isActive(`${home}/calendar/x`, group("Kalender"), home)).toBe(true);
    expect(isActive(`${home}/calendarium`, group("Kalender"), home)).toBe(false);
    expect(isActive(home, group("Heute"), home)).toBe(true);
    expect(isActive(`${home}/calendar`, group("Heute"), home)).toBe(false);
    expect(bestMatch(`${home}/invoices/tagesabschluss`, group("Finanzen"), home)).toBeGreaterThan(bestMatch(`${home}/invoices/tagesabschluss`, { key: "x", label: "x", href: `${home}/invoices` }, home));
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
