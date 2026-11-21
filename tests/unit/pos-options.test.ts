import { describe, expect, it } from "vitest";
import { checkChoice, composeLine, type GroupDef } from "../../src/domain/pos-options";

const garstufe: GroupDef = { id: "g1", name: "Garstufe", required: true, maxChoices: 1, options: [{ id: "rare", name: "rare", priceRappen: 0 }, { id: "medium", name: "medium", priceRappen: 0 }] };
const extras: GroupDef = { id: "g2", name: "Extras", required: false, maxChoices: 2, options: [{ id: "pilz", name: "Pilzsauce", priceRappen: 350 }, { id: "ei", name: "Spiegelei", priceRappen: 200 }, { id: "speck", name: "Speck", priceRappen: 300 }] };

describe("Optionen und Menüs (SPEC 19.49)", () => {
  it("Pflicht-Gruppe verlangt eine Wahl", () => {
    expect(checkChoice([garstufe, extras], [])).toBe("Bitte wählen: Garstufe.");
    expect(checkChoice([garstufe, extras], ["medium"])).toBeNull();
  });
  it("Einzelwahl und Mehrfachwahl mit Grenze", () => {
    expect(checkChoice([garstufe], ["rare", "medium"])).toContain("nur eine");
    expect(checkChoice([extras], ["pilz", "ei", "speck"])).toContain("höchstens 2");
    expect(checkChoice([extras], ["pilz", "ei"])).toBeNull();
  });
  it("fremde und doppelte Optionen werden abgelehnt", () => {
    expect(checkChoice([garstufe], ["pilz"])).toContain("gehört nicht");
    expect(checkChoice([garstufe], ["rare", "rare"])).toContain("doppelt");
  });
  it("Text und Preis: Artikelpreis plus Aufpreise, Sonderwunsch am Ende", () => {
    const c = composeLine({ name: "Entrecôte", priceRappen: 4200 }, [garstufe, extras], ["medium", "pilz"], "  ohne Zwiebeln ");
    expect(c.description).toBe("Entrecôte · medium · Pilzsauce · ohne Zwiebeln");
    expect(c.unitPriceRappen).toBe(4550);
    expect(c.options).toEqual([{ group: "Garstufe", name: "medium", priceRappen: 0 }, { group: "Extras", name: "Pilzsauce", priceRappen: 350 }]);
    expect(c.note).toBe("ohne Zwiebeln");
  });
  it("Menü: Pflicht-Gruppen ohne Aufpreis, Preis bleibt der Menüpreis", () => {
    const vor: GroupDef = { id: "v", name: "Vorspeise", required: true, maxChoices: 1, options: [{ id: "suppe", name: "Tagessuppe", priceRappen: 0 }, { id: "salat", name: "Blattsalat", priceRappen: 0 }] };
    const haupt: GroupDef = { id: "h", name: "Hauptgang", required: true, maxChoices: 1, options: [{ id: "fisch", name: "Felchen", priceRappen: 0 }, { id: "rind", name: "Rindsgeschnetzeltes", priceRappen: 400 }] };
    expect(checkChoice([vor, haupt], ["suppe"])).toBe("Bitte wählen: Hauptgang.");
    const c = composeLine({ name: "Tagesmenü", priceRappen: 3200 }, [vor, haupt], ["suppe", "rind"]);
    expect(c.description).toBe("Tagesmenü · Tagessuppe · Rindsgeschnetzeltes");
    expect(c.unitPriceRappen).toBe(3600);
  });
  it("Text höchstens 120 Zeichen", () => {
    expect(composeLine({ name: "A".repeat(100), priceRappen: 1 }, [], [], "x".repeat(200)).description.length).toBe(120);
  });
});
