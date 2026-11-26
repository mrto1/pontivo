import { describe, expect, it } from "vitest";
import { parseCartForm } from "../../components/public/cart-form";

const fd = (o: [string, string][]) => { const f = new FormData(); for (const [k, v] of o) f.append(k, v); return f; };

describe("parseCartForm (Vorbestellung, Bestellen am Tisch)", () => {
  it("liest Mengen, Optionen und Sonderwunsch je Variante", () => {
    expect(parseCartForm(fd([["p_a", "2"], ["p_b.0", "1"], ["o_b.0.g", "x"], ["n_b.0", " ohne Pfeffer "], ["p_b.1", "0"], ["o_b.1.g", ""], ["p_c", "0"]]))).toEqual([
      { itemId: "a", quantity: 2, optionIds: [], note: "" },
      { itemId: "b", quantity: 1, optionIds: ["x"], note: "ohne Pfeffer" },
    ]);
  });
  it("Wahl ohne Anzahl gilt als 1 Stück, leere Variante wird ignoriert", () => {
    expect(parseCartForm(fd([["p_b.0", "0"], ["o_b.0.g", "medium"], ["p_b.1", "0"], ["n_b.1", ""]]))).toEqual([{ itemId: "b", quantity: 1, optionIds: ["medium"], note: "" }]);
  });
});
