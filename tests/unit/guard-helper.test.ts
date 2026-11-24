import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });

describe("Zugriffsprüfung in Admin-Seiten (SPEC 19.51)", () => {
  it("Rolle und Modul in einem Aufruf: requireHotelModule statt requireHotel + requireModule direkt hintereinander", () => {
    const offenders = walk("app").filter((p) => /await requireHotel\([^\n]*\);\n\s*await requireModule\(/.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});
