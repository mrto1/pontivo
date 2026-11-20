import { describe, expect, it } from "vitest";
import { adminNav, allPages, isActive, sectionFor } from "../../src/admin/nav";
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
    expect(nav.primary.length).toBeLessThanOrEqual(4); // passt in die untere Leiste
    expect(keys).toEqual(expect.arrayContaining(["home", "calendar", "bookings", "guests", "inquiries", "vouchers", "report", "rooms", "site", "channex", "embed", "settings"]));
  });

  it("zusammengelegte Punkte: Gäste, Angebot und Vertrieb haben Reiter; im Menü steht nur der Sammelpunkt", () => {
    const nav = adminNav(hotel);
    const menu = [...nav.primary, ...nav.groups.flatMap((g) => g.items)].map((i) => i.label);
    expect(menu).toEqual(expect.arrayContaining(["Gäste", "Angebot", "Vertrieb"]));
    expect(menu).not.toEqual(expect.arrayContaining(["Anfragen"]));
    const home = "/mypontivo/h1";
    expect(sectionFor("/mypontivo/h1/inquiries", nav, home)?.label).toBe("Gäste");
    expect(sectionFor("/mypontivo/h1/site/blocks", nav, home)?.label).toBe("Angebot");
    expect(sectionFor("/mypontivo/h1/channex/booking", nav, home)?.label).toBe("Vertrieb");
    expect(sectionFor("/mypontivo/h1/preise", nav, home)?.label).toBe("Kalender"); // Preisempfehlung ist Reiter beim Kalender
    expect(sectionFor("/mypontivo/h1/home", nav, home)).toBeNull();
    const guests = nav.primary.find((i) => i.key === "guests")!;
    expect(isActive("/mypontivo/h1/vouchers", guests, home)).toBe(true); // Reiter hält den Sammelpunkt aktiv
  });

  it("Das Menü ist immer vollständig: kein «Einrichten»-Punkt, Konto über den Avatar", () => {
    const keys = allPages(adminNav(hotel)).map((i) => i.key);
    expect(keys).not.toContain("einrichten");
    expect(keys).toEqual(expect.arrayContaining(["calendar", "rooms", "site", "settings", "bookings"]));
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
