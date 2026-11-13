import { describe, expect, it } from "vitest";
import { adminNav, isActive } from "../../src/admin/nav";
import { GET as manifest } from "../../app/admin/manifest.webmanifest/route";
import { GET as sw } from "../../app/admin/sw.js/route";
import { GET as icon } from "../../app/admin/pwa-icon/[size]/route";

const hotel = { id: "h1", slug: "demo", primaryDomain: null };

describe("Admin-Menü", () => {
  it("jede Seite genau einmal; alle Links gehören zum eigenen Hotel", () => {
    const nav = adminNav(hotel, false);
    const all = [...nav.primary, ...nav.groups.flatMap((g) => g.items)];
    const keys = all.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const i of all) if (!i.external) expect(i.href.startsWith("/admin/h1")).toBe(true);
    expect(nav.primary.length).toBeLessThanOrEqual(4); // passt in die untere Leiste
    expect(keys).toEqual(expect.arrayContaining(["home", "calendar", "bookings", "guests", "inquiries", "vouchers", "report", "rooms", "site", "channex", "embed", "settings"]));
  });

  it("Einrichtung: schlankes Menü; eigene Domain wird für «Ansehen» verwendet", () => {
    expect(adminNav(hotel, true).primary.map((i) => i.key)).toEqual(["einrichten", "rooms", "site", "settings"]);
    const withDomain = adminNav({ ...hotel, primaryDomain: "hotel.ch" }, false);
    expect(withDomain.groups.flatMap((g) => g.items).find((i) => i.key === "view")!.href).toBe("//hotel.ch");
  });

  it("aktive Seite: Übersicht nur exakt, andere auch bei Unterseiten", () => {
    const nav = adminNav(hotel, false);
    const home = "/admin/h1";
    const [overview, calendar] = nav.primary;
    expect(isActive("/admin/h1", overview, home)).toBe(true);
    expect(isActive("/admin/h1/calendar", overview, home)).toBe(false);
    expect(isActive("/admin/h1/calendar/x", calendar, home)).toBe(true);
    expect(isActive("/admin/h1/calendarium", calendar, home)).toBe(false);
  });
});

describe("PWA", () => {
  it("Manifest nur für /admin, mit 192er und 512er Icon", async () => {
    const m = await manifest().json();
    expect(m).toMatchObject({ start_url: "/admin", scope: "/admin/", display: "standalone" });
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("Service Worker: Geltungsbereich /admin, nichts ausser der Offline-Seite wird gespeichert", async () => {
    const res = sw();
    expect(res.headers.get("Service-Worker-Allowed")).toBe("/admin/");
    const js = await res.text();
    expect(js).toContain('"/admin/offline"');
    expect(js).toContain('startsWith("/admin")');
    expect(js).not.toMatch(/cache\.put|addAll/);
  });

  it("Icons sind PNG; unbekannte Grösse → 404", async () => {
    const ok = await icon(new Request("http://x"), { params: Promise.resolve({ size: "192" }) });
    expect(ok.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await ok.arrayBuffer()).slice(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));
    expect((await icon(new Request("http://x"), { params: Promise.resolve({ size: "7" }) })).status).toBe(404);
  });
});
