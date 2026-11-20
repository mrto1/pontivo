import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

// formatChf liefert schon «CHF 12.50»; ein zweites «CHF» davor ergibt «CHF CHF 12.50».
describe("kein doppeltes CHF", () => {
  it("formatChf wird nirgends mit vorangestelltem CHF verwendet", () => {
    const files = execSync("git ls-files 'app/**/*.tsx' 'components/**/*.tsx' 'src/**/*.ts' 'src/**/*.tsx'", { encoding: "utf8" }).split("\n").filter(Boolean);
    const bad = files.filter((f) => /CHF\s*(\$?\{|\$\{)\s*formatChf\(/.test(readFileSync(f, "utf8")) || /CHF\s*\$\{formatChf\(/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
