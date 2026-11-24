import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Eine .gitignore-Regel darf nie Quellcode erfassen (Buchhaltung-Seite fehlte deshalb im Deployment).
describe("gitignore", () => {
  it("ignoriert keine Dateien unter app/, src/, components/", () => {
    const out = execFileSync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "app", "src", "components", "db"], { encoding: "utf8" });
    expect(out.split("\n").filter((l) => l && !l.includes("node_modules"))).toEqual([]);
  });
});
