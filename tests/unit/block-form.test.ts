import { describe, expect, it } from "vitest";
import { blockFromForm, hoursFrom, priceFrom } from "../../src/domain/block-form";
import { UserError } from "../../src/domain/errors";

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };

describe("Baustein-Formular", () => {
  it("liest Preise in Rappen", () => {
    expect(priceFrom("28.50")).toBe(2850);
    expect(priceFrom("CHF 28.–")).toBe(2800);
    expect(priceFrom("28,5")).toBe(2850);
    expect(priceFrom("")).toBeNull();
    expect(() => priceFrom("teuer")).toThrow(UserError);
  });
  it("Öffnungszeiten: sortiert, Ruhetag leer, unvollständiges Fenster ist ein Fehler", () => {
    const h = hoursFrom(form({ "d0.1.from": "18:00", "d0.1.to": "22:00", "d0.0.from": "11:30", "d0.0.to": "14:00" }));
    expect(h.days[0]).toEqual([{ from: "11:30", to: "14:00" }, { from: "18:00", to: "22:00" }]);
    expect(h.days[1]).toEqual([]);
    expect(() => hoursFrom(form({ "d2.0.from": "18:00" }))).toThrow(UserError);
  });
  it("wiederholte Einträge: leere fallen weg", () => {
    const b = blockFromForm(form({ "heading.de": "Fragen", "it0.q.de": "Parkplatz?", "it0.a.de": "Ja", "it1.q.de": "", "it1.a.de": "" }), "faq", "b1", new Map()) as { items: unknown[] };
    expect(b.items).toHaveLength(1);
  });
});
