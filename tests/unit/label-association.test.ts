import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : []; });

describe("Formularfelder (Barrierefreiheit)", () => {
  it("jede Beschriftung direkt vor einem Feld ist mit ihm verknüpft (htmlFor und id)", () => {
    const re = /<label>[^<{]*<\/label>\s*<(?:input|select|textarea)\b/g;
    const offenders = walk("app").filter((p) => re.test(readFileSync(p, "utf8")));
    expect(offenders, "Beschriftung mit htmlFor und Feld mit gleicher id verknüpfen").toEqual([]);
  });
});
