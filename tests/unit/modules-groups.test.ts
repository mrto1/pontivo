import { describe, expect, it } from "vitest";
import { MODULE_GROUPS, MODULE_KEYS } from "@/src/domain/modules";

describe("Funktionen: Gruppen", () => {
  it("jedes Modul steht in genau einer Gruppe", () => {
    const keys = MODULE_GROUPS.flatMap((g) => g.keys);
    expect([...keys].sort()).toEqual([...MODULE_KEYS].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });
});
