import { describe, expect, it } from "vitest";
import { boardLabel, splitBoard } from "../../src/domain/board";

describe("Pauschalen (SPEC 19.4)", () => {
  it("Halbpension: Verpflegung je Person und Nacht wird abgespalten, Summe bleibt", () => {
    const r = splitBoard(50000, "half", 2, 2, 3500); // 2 Pers. × 2 Nächte × 35.-
    expect(r).toEqual({ stayRappen: 36000, mealsRappen: 14000 });
    expect(r.stayRappen + r.mealsRappen).toBe(50000);
  });
  it("Verpflegung übersteigt nie den Zimmerbetrag", () => {
    expect(splitBoard(10000, "full", 4, 3, 9000)).toEqual({ stayRappen: 0, mealsRappen: 10000 });
  });
  it("Frühstück, ohne Verpflegung oder ohne Wert: keine Aufteilung", () => {
    expect(splitBoard(20000, "breakfast", 2, 1, 3000).mealsRappen).toBe(0);
    expect(splitBoard(20000, "none", 2, 1, 3000).mealsRappen).toBe(0);
    expect(splitBoard(20000, "half", 2, 1, 0).mealsRappen).toBe(0);
  });
  it("Bezeichnungen", () => {
    expect(boardLabel("half")).toBe("Halbpension");
    expect(boardLabel("none")).toBe("nur Übernachtung");
  });
});
