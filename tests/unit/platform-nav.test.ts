import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allPages, bestMatch, sectionFor } from "../../src/admin/nav";
import { platformNav, PLATFORM_HOME } from "../../src/admin/platform-nav";

const nav = platformNav();
const dirOf = (href: string) => join(process.cwd(), "app", href.replace(/^\//, ""));

describe("Plattform-Menü", () => {
  it("jeder Menüpunkt und Reiter hat eine Seite", () => {
    for (const p of allPages(nav)) {
      if (p.href.startsWith("/admin")) continue;
      expect(existsSync(join(dirOf(p.href), "page.tsx")), p.href).toBe(true);
    }
  });

  it("Schlüssel und Adressen sind eindeutig", () => {
    const pages = allPages(nav).filter((p) => !p.href.startsWith("/admin"));
    expect(new Set(pages.map((p) => p.href)).size).toBe(pages.length);
    expect(new Set(pages.map((p) => p.key)).size).toBe(pages.length);
  });

  it("Reiter gruppieren nach Thema: Betriebe | Benutzer, Rechnungen | MWST, Admins | Website | Schulferien", () => {
    const tabs = (key: string) => nav.primary.find((i) => i.key === key)?.tabs?.map((t) => t.label);
    expect(tabs("pf-hotels")).toEqual(["Betriebe", "Benutzer"]);
    expect(tabs("pf-billing")).toEqual(["Rechnungen", "MWST"]);
    expect(tabs("pf-settings")).toEqual(["Plattform-Admins", "Website-Texte", "Schulferien"]);
  });

  it("die Seite wählt den richtigen Sammelpunkt (Reiterzeile) aus", () => {
    expect(sectionFor("/plattform/benutzer", nav, PLATFORM_HOME)?.key).toBe("pf-hotels");
    expect(sectionFor("/plattform/mwst", nav, PLATFORM_HOME)?.key).toBe("pf-billing");
    expect(sectionFor("/plattform/schulferien", nav, PLATFORM_HOME)?.key).toBe("pf-settings");
    expect(sectionFor("/plattform", nav, PLATFORM_HOME)).toBeNull();
    expect(sectionFor("/plattform/google", nav, PLATFORM_HOME)?.key).toBe("pf-sales");
  });

  it("Übersicht ist nur auf der Startseite aktiv", () => {
    const home = nav.primary[0];
    expect(bestMatch("/plattform", home, PLATFORM_HOME)).toBeGreaterThan(0);
    expect(bestMatch("/plattform/betriebe", home, PLATFORM_HOME)).toBe(0);
  });

  it("Rücksprungziele der Aktionen sind genau die Seiten mit Formularen", () => {
    const src = readFileSync(join(process.cwd(), "app/plattform/actions.ts"), "utf8");
    const listed = [...src.matchAll(/"(\/plattform\/[a-z]+)"/g)].map((m) => m[1]);
    for (const href of new Set(listed)) expect(existsSync(join(dirOf(href), "page.tsx")), href).toBe(true);
    // jede Seite, die ein Formular mit `to` sendet, steht in der Liste
    for (const dir of ["betriebe", "benutzer", "rechnungen", "mwst", "admins", "schulferien"]) expect(listed).toContain(`/plattform/${dir}`);
  });
});
