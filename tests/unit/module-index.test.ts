import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { moduleIndex } from "../../src/docs/module-index";
import { MODULES } from "../../src/domain/modules";

describe("Modulübersicht (docs/MODULES.md)", () => {
  it("ist aktuell und nennt jedes Modul", () => {
    const file = readFileSync("docs/MODULES.md", "utf8");
    for (const m of MODULES) expect(file, m.key).toContain(`| \`${m.key}\` |`);
    expect(file, "veraltet: npx tsx scripts/module-index.ts ausführen").toBe(moduleIndex());
  });
});
