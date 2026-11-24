import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { s } from "../../src/lib/form";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });

describe("Formular-Helfer", () => {
  it("s() liest Text ohne Rand; fehlendes Feld ist leer", () => {
    const f = new FormData();
    f.set("a", "  Hallo ");
    expect(s(f, "a")).toBe("Hallo");
    expect(s(f, "fehlt")).toBe("");
  });
  it("keine eigene Kopie von s() in app/ und components/", () => {
    const offenders = [...walk("app"), ...walk("components")].filter((p) => /^const s = \(f: FormData, k: string\) => String\(f\.get\(k\) \?\? ""\)\.trim\(\);$/m.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});
