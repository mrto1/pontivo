import { describe, expect, it } from "vitest";
import { priceSelection, upsellFee, UpsellError } from "../../src/domain/upsell";

const defs = [
  { id: "a", priceRappen: 1800, unit: "per_person_night" as const, maxQuantity: 1, active: true },
  { id: "b", priceRappen: 5000, unit: "per_booking" as const, maxQuantity: 2, active: true },
  { id: "c", priceRappen: 900, unit: "per_night" as const, maxQuantity: 3, active: false },
];

describe("Upselling: Auswahl und Preis", () => {
  it("rechnet pro Person und Nacht und pro Buchung", () => {
    const r = priceSelection(defs, [{ id: "a", quantity: 2 }, { id: "b", quantity: 1 }], { nights: 3, persons: 2 });
    expect(r.lines.map((l) => l.amountRappen)).toEqual([1800 * 2 * 3, 5000]);
    expect(r.totalRappen).toBe(10800 + 5000);
  });
  it("Menge 0 wird ignoriert, nichts gewählt → Fehler", () => {
    expect(priceSelection(defs, [{ id: "a", quantity: 0 }, { id: "b", quantity: 1 }], { nights: 1, persons: 2 }).lines).toHaveLength(1);
    expect(() => priceSelection(defs, [{ id: "a", quantity: 0 }], { nights: 1, persons: 2 })).toThrow(UpsellError);
  });
  it("zu grosse Menge, inaktive, unbekannte, doppelte oder negative Angaben werden abgelehnt", () => {
    const ctx = { nights: 2, persons: 2 };
    expect(() => priceSelection(defs, [{ id: "a", quantity: 3 }], ctx)).toThrow(UpsellError); // mehr als Personen
    expect(() => priceSelection(defs, [{ id: "b", quantity: 3 }], ctx)).toThrow(UpsellError); // über Höchstmenge
    expect(() => priceSelection(defs, [{ id: "c", quantity: 1 }], ctx)).toThrow(UpsellError);
    expect(() => priceSelection(defs, [{ id: "zzz", quantity: 1 }], ctx)).toThrow(UpsellError);
    expect(() => priceSelection(defs, [{ id: "b", quantity: 1 }, { id: "b", quantity: 1 }], ctx)).toThrow(UpsellError);
    expect(() => priceSelection(defs, [{ id: "b", quantity: -1 }], ctx)).toThrow(UpsellError);
    expect(() => priceSelection(defs, [{ id: "b", quantity: 1.5 }], ctx)).toThrow(UpsellError);
  });
  it("Provision 5 % kaufmännisch gerundet", () => {
    expect(upsellFee(10000, 500)).toBe(500);
    expect(upsellFee(1990, 500)).toBe(100); // 99.5 → 100
    expect(upsellFee(1000, 0)).toBe(0);
  });
});
