import { describe, expect, it } from "vitest";
import { adminNav, allPages, allPagesBoth, areaOfPath, bestMatch, inSettings, isActive, isActiveIn, leafKeys, sectionFor, settingsGroups } from "../../src/admin/nav";
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
    const byKey = Object.fromEntries(allPagesBoth(hotel).map((i) => [i.key, i.href.replace("/mypontivo/h1/", "")]));
    expect(byKey).toMatchObject({
      home: "/mypontivo/h1", housekeeping: "housekeeping", inbox: "inbox", restaurant: "restaurant", reservations: "restaurant/reservierungen", kitchen: "restaurant/kueche", kasse: "kasse", posclose: "restaurant/abschluss", plan: "plan", calendar: "calendar", pricing: "preise",
      bookings: "bookings", groups: "groups", resources: "resources", vouchers: "vouchers", guestbook: "guestbook", marketing: "marketing", feedback: "feedback",
      invoices: "invoices", dayclose: "invoices/tagesabschluss", debtors: "invoices/debitoren", owners: "owners", statistics: "statistics", hesta: "statistics/hesta", accountingexport: "buchhaltung", reports: "berichte",
      settings: "settings", rooms: "rooms", extras: "rooms/extras", payments: "zahlungen", team: "team", site: "site", direct: "direktbuchung", api: "api", channex: "channex", ical: "ical", mailtexts: "mail-texte", upsell: "upsell", "ki-chat": "ki-chat",
      funktionen: "funktionen", terminal: "terminal", access: "zutritt", positems: "restaurant/artikel", posdevices: "restaurant/geraete", posbridge: "posbridge", dininghome: "restaurant/heute", resplan: "restaurant/tischplan", waitlist: "restaurant/warteliste", ressettings: "restaurant/einstellungen", migration: "migration", report: "report", mypontivo: "mypontivo", firstweek: "erste-woche", help: "hilfe",
    });
  });

  it("Reiter der Hauptpunkte", () => {
    expect(tabKeys("Heute")).toEqual(["home", "inbox", "housekeeping"]); // Restaurant ist ein eigener Bereich (SPEC 20.1)
    expect(group("Heute").tabs![0].label).toBe("Tagesliste");
    expect(tabKeys("Kalender")).toEqual(["plan", "calendar", "pricing"]);
    expect(tabKeys("Buchungen")).toEqual(["bookings", "groups", "resources", "vouchers", "g-guests"]);
    expect(group("Buchungen").tabs![4].tabs!.map((t) => t.key)).toEqual(["guestbook", "marketing", "feedback"]);
    expect(tabKeys("Finanzen")).toEqual(["invoices", "dayclose", "debtors", "owners", "g-statistics", "reports", "accountingexport"]);
    expect(group("Finanzen").tabs![4].tabs!.map((t) => t.key)).toEqual(["statistics", "hesta"]);
  });

  it("Zahnrad: Gruppen mit je einem Satz Erklärung", () => {
    const groups = settingsGroups(nav);
    expect(groups.map((g) => g.title)).toEqual(["Betrieb", "Verkauf", "Gastronomie", "Technik"]);
    expect(groups.map((g) => g.items.map((i) => i.label))).toEqual([
      ["Grunddaten", "Zahlungsmethoden", "Zimmer & Tarife", "Zusatzleistungen", "Team & Rollen"],
      ["Website & Buchung", "Kanäle", "Gäste-Mails", "Gästeportal", "Upselling", "KI-Chat"],
      ["Speisekarte", "Tischplan & Reservierung online", "Online-Bestellung & Lieferung", "Kasse"],
      ["Funktionen", "Geräte", "Datenübernahme", "Abo & Gebühren"],
    ]);
    for (const g of groups) { expect(g.lead.length).toBeGreaterThan(10); for (const i of g.items) expect(i.lead, i.label).toBeTruthy(); }
    expect(nav.settings.tabs!.find((i) => i.label === "Website & Buchung")!.tabs!.map((t) => t.key)).toEqual(["site", "direct", "api"]);
    expect(nav.settings.tabs!.find((i) => i.label === "Kanäle")!.tabs!.map((t) => t.key)).toEqual(["channex", "ical"]);
    expect(nav.settings.tabs!.find((i) => i.label === "Geräte")!.tabs!.map((t) => t.key)).toEqual(["terminal", "access"]);
    expect(nav.settings.tabs!.find((i) => i.label === "Kasse")!.tabs!.map((t) => t.key)).toEqual(["posdevices", "posbridge"]);
  });

  it("Kalender startet mit dem Zimmerplan, wenn die Rezeption an ist, sonst mit Preise & Verfügbarkeit", () => {
    expect(group("Kalender").href).toBe("/mypontivo/h1/plan");
    const off = adminNav(hotel, new Set(["plan"]));
    const cal = off.primary.find((i) => i.label === "Kalender")!;
    expect(cal.tabs![0].key).toBe("calendar");
    expect(cal.href).toBe("/mypontivo/h1/calendar");
  });

  it("Gastronomie: Reservierung, Speisekarte, Küche mit Modul restaurant; Tische, Kasse, Abschluss nur mit pos (SPEC 20.1)", () => {
    const dining = (rows: { module: string; enabled: boolean }[]) => allPages(adminNav(hotel, hiddenNavKeys(rows), { area: "dining" })).map((i) => i.key);
    const onlyRes = dining([{ module: "restaurant", enabled: true }]);
    expect(onlyRes).toEqual(expect.arrayContaining(["dininghome", "reservations", "resplan", "waitlist", "kitchen", "positems", "ressettings"]));
    expect(onlyRes).not.toContain("kasse");
    expect(onlyRes).not.toContain("restaurant");
    expect(onlyRes).not.toContain("posclose");
    expect(dining([{ module: "restaurant", enabled: true }, { module: "pos", enabled: true }])).toEqual(expect.arrayContaining(["restaurant", "kasse", "posclose", "posdevices"]));
    // beides ist von Haus aus aus
    const none = dining([]);
    for (const k of ["dininghome", "reservations", "kasse", "positems"]) expect(none).not.toContain(k);
  });

  it("Restaurant-Baum: vier Hauptpunkte; reines Restaurant ohne Unterkunftspunkte im Zahnrad (SPEC 20.1)", () => {
    const d = adminNav(hotel, new Set(), { area: "dining", kind: "restaurant" });
    expect(d.primary.map((i) => i.label)).toEqual(["Heute", "Reservierungen", "Bestellungen", "Finanzen"]);
    expect(d.primary.map((i) => i.tabs!.map((t) => t.key))).toEqual([
      ["dininghome", "inbox"], ["reservations", "resplan", "waitlist", "guestbook"], ["onlineorders", "restaurant", "kasse", "kitchen", "driver"], ["posclose", "onlinesales", "invoices", "vouchers", "accountingexport"],
    ]);
    const keys = allPages(d).map((i) => i.key);
    for (const k of ["rooms", "extras", "channex", "ical", "gaesteportal", "upsell", "direct", "api", "access", "migration", "plan", "calendar", "housekeeping"]) expect(keys).not.toContain(k);
    expect(keys).toEqual(expect.arrayContaining(["settings", "payments", "team", "site", "positems", "ressettings", "mailtexts", "ki-chat", "terminal", "posdevices", "posbridge", "report"]));
    expect(d.settings.tabs!.find((i) => i.key === "site")!.label).toBe("Website");
  });

  it("Bereich aus der Adresse: Gastronomie-Seiten legen ihn fest, geteilte Seiten nicht (SPEC 20.1)", () => {
    const home = "/mypontivo/h1";
    const navs = { lodging: adminNav(hotel), dining: adminNav(hotel, new Set(), { area: "dining" }) };
    expect(areaOfPath(`${home}/restaurant/reservierungen`, navs, home)).toBe("dining");
    expect(areaOfPath(`${home}/restaurant/abschluss`, navs, home)).toBe("dining");
    expect(areaOfPath(`${home}/kasse`, navs, home)).toBe("dining");
    expect(areaOfPath(`${home}/bookings/x`, navs, home)).toBe("lodging");
    expect(areaOfPath(home, navs, home)).toBe("lodging");
    for (const p of ["inbox", "invoices", "vouchers", "einstellungen", "settings", "mypontivo"]) expect(areaOfPath(`${home}/${p}`, navs, home)).toBeNull();
    expect(areaOfPath(`${home}/restaurant/artikel`, navs, home)).toBe("dining"); // Speisekarte gehört zur Gastronomie
    // Nur der genaueste Hauptpunkt leuchtet: Kassenabschluss → Finanzen, nicht Bestellungen
    const d = navs.dining;
    const active = d.primary.filter((i) => isActiveIn(`${home}/restaurant/abschluss`, d, i, home)).map((i) => i.label);
    expect(active).toEqual(["Finanzen"]);
    expect(sectionFor(`${home}/restaurant/abschluss`, d, home)?.label).toBe("Finanzen");
    expect(sectionFor(`${home}/restaurant/tischplan`, d, home)?.label).toBe("Reservierungen");
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
    expect(sectionFor(`${home}/zutritt`, nav, home)?.label).toBe("Geräte");
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

  it("Zahnrad-Seite unter einer Adresse von «Bestellungen» bleibt im Zahnrad (Speisekarte)", () => {
    const nav = adminNav(hotel, new Set(), { area: "dining" });
    const p = "/mypontivo/h1/restaurant/artikel";
    expect(inSettings(p, nav, "/mypontivo/h1")).toBe(true);
    expect(isActiveIn(p, nav, nav.primary[0], "/mypontivo/h1")).toBe(false);
    expect(sectionFor(p, nav, "/mypontivo/h1")?.key).not.toBe("g-dining-orders");
    expect(isActiveIn(p, nav, nav.primary[2], "/mypontivo/h1")).toBe(false);
    // Tische bleiben unter Bestellungen
    expect(inSettings("/mypontivo/h1/restaurant", nav, "/mypontivo/h1")).toBe(false);
    expect(isActiveIn("/mypontivo/h1/restaurant", nav, nav.primary[2], "/mypontivo/h1")).toBe(true);
  });
});
