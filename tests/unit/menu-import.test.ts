import { describe, expect, it } from "vitest";
import { parseMenuDraft, priceToRappen, draftToRows } from "../../src/domain/menu-import";

describe("KI-Speisekarte: Entwurf lesen (SPEC 19.49 D)", () => {
  it("Preise in Rappen aus Zahl und Text", () => {
    expect(priceToRappen(24.5)).toBe(2450);
    expect(priceToRappen("CHF 18.90")).toBe(1890);
    expect(priceToRappen("7,5")).toBe(750);
    expect(priceToRappen(-1)).toBeNull();
    expect(priceToRappen("gratis")).toBeNull();
    expect(priceToRappen(99999)).toBeNull();
  });
  it("nur gültige Artikel, doppelte entfernt, in Rappen", () => {
    const d = parseMenuDraft('Hier: {"items":[{"category":"Essen","name":"Rösti","price":21.5},{"category":"Essen","name":"rösti","price":22},{"name":"","price":3},{"name":"Ohne Preis"},{"category":"Getränke","name":"Wasser 5dl","price":"CHF 4.50","description":"still"}]}');
    expect(d!.items).toEqual([
      { category: "Essen", name: "Rösti", description: "", priceRappen: 2150 },
      { category: "Getränke", name: "Wasser 5dl", description: "still", priceRappen: 450 },
    ]);
  });
  it("Unbrauchbares ergibt null", () => {
    expect(parseMenuDraft("kein json")).toBeNull();
    expect(parseMenuDraft('{"items":[]}')).toBeNull();
    expect(parseMenuDraft('{"items":[{"name":"X","price":"abc"}]}')).toBeNull();
  });
  it("Zeilen mit Standard-MWST", () => {
    expect(draftToRows([{ category: "A", name: "B", description: "", priceRappen: 100 }])[0]).toMatchObject({ vatDineInBps: 810, vatTakeawayBps: 260, dailySpecial: false });
  });
});
