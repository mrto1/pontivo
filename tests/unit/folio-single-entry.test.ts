import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });

describe("Posten in der Buchung (SPEC 19.51)", () => {
  it("nur src/services/folio.ts schreibt in folio_items", () => {
    const offenders = [...walk("src"), ...walk("app").filter(Boolean)].filter((p) => !p.endsWith("services/folio.ts") && /insert\(folioItems\)/.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});
