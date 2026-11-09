import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regel (CLAUDE.md): Es gibt keinen Code für ein einzelnes Hotel. Alle Hotels laufen auf demselben Code;
 * Unterschiede sind Daten (Inhalte, Layout, Schrift, Farbe, Bausteine). Dieser Test schlägt an, wenn
 * Programmcode ein bestimmtes Hotel fest verdrahtet.
 */

const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["app", "components", "src"];
// Erlaubt: Standardwert der Demo-Variable (verweist auf das Demo-Hotel der Pontivo-Startseite, nicht auf einen Kunden)
const ALLOWED = new Set(["src/env.ts"]);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

const RULES: { name: string; re: RegExp }[] = [
  // hotel.slug === "seelust", hotel.id !== "…", hotel.primaryDomain === "www.…" (auch umgekehrt)
  { name: "Hotel mit festem Wert verglichen", re: /\bhotel\w*\.(slug|id|name|primaryDomain|legalName|contactEmail)\s*[!=]==?\s*["'`][^"'`]/ },
  { name: "Hotel mit festem Wert verglichen", re: /["'`][^"'`]+["'`]\s*[!=]==?\s*\bhotel\w*\.(slug|id|name|primaryDomain|legalName|contactEmail)\b/ },
  { name: "Hotel-ID mit festem Wert verglichen", re: /\bhotelId\s*[!=]==?\s*["'`][^"'`]/ },
  // eine feste UUID im Code ist praktisch immer ein bestimmtes Hotel, Zimmer oder Tarif
  { name: "feste UUID", re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i },
  // CSS nur für ein Hotel, z. B. .hotel-seelust oder [data-hotel="…"]
  { name: "CSS für ein bestimmtes Hotel", re: /\.hotel-[a-z0-9-]+\s*[{,.:\s]|\[data-hotel(-[a-z]+)?=/ },
];

describe("Kein Code für einzelne Hotels", () => {
  const all = DIRS.flatMap((d) => files(path.join(ROOT, d)));

  it("findet Quelldateien", () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it("Programmcode verdrahtet kein bestimmtes Hotel", () => {
    const hits: string[] = [];
    for (const f of all) {
      const rel = path.relative(ROOT, f).replace(/\\/g, "/");
      if (ALLOWED.has(rel)) continue;
      fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        for (const r of RULES) if (r.re.test(line)) hits.push(`${rel}:${i + 1} (${r.name}): ${line.trim().slice(0, 120)}`);
      });
    }
    // Unterschiede zwischen Hotels gehören in die Daten (Einstellungen, Bausteine), nicht in den Code.
    expect(hits).toEqual([]);
  });

  it("die Prüfung erkennt Verstösse", () => {
    const bad = ['if (hotel.slug === "seelust") {', 'const x = "www.seelust.ch" === hotel.primaryDomain;', '.hotel-seelust .hero { color: red }', 'if (hotelId === "a") x()'];
    for (const line of bad) expect(RULES.some((r) => r.re.test(line))).toBe(true);
    const ok = ['if (page.slug === "") return', 'const s = hotel.slug;', 'where(eq(hotels.id, hotelId))'];
    for (const line of ok) expect(RULES.some((r) => r.re.test(line))).toBe(false);
  });
});
