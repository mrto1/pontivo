import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Einheitliche Bauweise (CLAUDE.md, SPEC 19.66):
 * - Formular-Aktionen im Admin laufen über `hotelAction` (src/lib/hotel-action.ts). Seiten, die Fehler noch selbst
 *   abfangen und die Meldung selbst in die Adresse schreiben, stehen in LEGACY; die Liste darf nur kürzer werden.
 * - Keine festen Inline-Styles: dafür gibt es Klassen (app/styles/). Erlaubt sind berechnete Werte (Breite eines Balkens, Farbe eines Kellners).
 */
const ROOT = path.resolve(__dirname, "../..");
const files = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
});

const LEGACY = new Set([
  "app/admin/[hotelId]/bookings/[bookingId]/access-actions.ts",
  "app/admin/[hotelId]/bookings/[bookingId]/cash-actions.ts",
  "app/admin/[hotelId]/bookings/[bookingId]/terminal-actions.ts",
  "app/admin/[hotelId]/bookings/new-booking-action.ts",
  "app/admin/[hotelId]/buchhaltung/page.tsx",
  "app/admin/[hotelId]/channex/_meta/actions.ts",
  "app/admin/[hotelId]/channex/airbnb/page.tsx",
  "app/admin/[hotelId]/channex/airbnb/return/route.ts",
  "app/admin/[hotelId]/channex/page.tsx",
  "app/admin/[hotelId]/einrichten/actions.ts",
  "app/admin/[hotelId]/feedback/page.tsx",
  "app/admin/[hotelId]/funktionen/page.tsx",
  "app/admin/[hotelId]/gaesteportal/page.tsx",
  "app/admin/[hotelId]/groups/page.tsx",
  "app/admin/[hotelId]/guestbook/page.tsx",
  "app/admin/[hotelId]/invoices/page.tsx",
  "app/admin/[hotelId]/invoices/tagesabschluss/page.tsx",
  "app/admin/[hotelId]/karte/page.tsx",
  "app/admin/[hotelId]/migration/page.tsx",
  "app/admin/[hotelId]/migration/umschalten/page.tsx",
  "app/admin/[hotelId]/offers/[offerId]/page.tsx",
  "app/admin/[hotelId]/photo-actions.ts",
  "app/admin/[hotelId]/plan/page.tsx",
  "app/admin/[hotelId]/posbridge/page.tsx",
  "app/admin/[hotelId]/resources/angebote/page.tsx",
  "app/admin/[hotelId]/restaurant/abschluss/page.tsx",
  "app/admin/[hotelId]/restaurant/bestellungen/page.tsx",
  "app/admin/[hotelId]/restaurant/fahrer/page.tsx",
  "app/admin/[hotelId]/restaurant/tisch-qr/page.tsx",
  "app/admin/[hotelId]/restaurant/tischplan/page.tsx",
  "app/admin/[hotelId]/rooms/page.tsx",
  "app/admin/[hotelId]/terminal/page.tsx",
  "app/admin/[hotelId]/zutritt/page.tsx",
]);

describe("Bauweise", () => {
  it("neue Admin-Aktionen verwenden hotelAction statt eigener Fehlerbehandlung", () => {
    const bad = files("app/admin").filter((f) => {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      return /catch \(e\)/.test(src) && /msg=(\$\{encodeURIComponent|" \+ encodeURIComponent)/.test(src);
    });
    expect(bad.filter((f) => !LEGACY.has(f))).toEqual([]);
  });
  it("die Liste der alten Seiten ist aktuell (umgestellte Seiten daraus entfernen)", () => {
    for (const f of LEGACY) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      expect(/catch \(e\)/.test(src) && /msg=(\$\{encodeURIComponent|" \+ encodeURIComponent)/.test(src), f).toBe(true);
    }
  });
  it("keine festen Inline-Styles (nur berechnete Werte)", () => {
    const bad: string[] = [];
    for (const f of [...files("app"), ...files("components")].filter((x) => x.endsWith(".tsx"))) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      for (const m of src.matchAll(/style=\{\{([^{}]*)\}\}/g)) {
        const body = m[1];
        // nur Literale (Zahlen, Texte), keine Variablen oder Ausdrücke; SVG-Verläufe (stopColor) ausgenommen
        const literal = body.split(",").every((p) => /^\s*[a-zA-Z]+\s*:\s*("[^"]*"|'[^']*'|-?\d+(\.\d+)?)\s*$/.test(p) || !p.trim());
        if (literal && !/stopColor|visibility/.test(body)) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
