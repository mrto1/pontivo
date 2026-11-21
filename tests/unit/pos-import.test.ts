import { describe, expect, it } from "vitest";
import { parsePosItems, parsePosTables, posItemsTemplate, posTablesTemplate } from "../../src/domain/pos-import";

describe("CSV-Import Restaurantkasse (SPEC 19.48)", () => {
  it("Vorlagen lassen sich wieder einlesen", () => {
    const i = parsePosItems(posItemsTemplate());
    expect(i.problems).toEqual([]);
    expect(i.rows).toHaveLength(2);
    expect(i.rows[1]).toMatchObject({ name: "Rösti mit Spiegelei", priceRappen: 2150, vatDineInBps: 810, vatTakeawayBps: 260, dailySpecial: true });
    expect(parsePosTables(posTablesTemplate()).names).toEqual(["1", "2", "Terrasse 1"]);
  });
  it("Komma, Dezimalkomma, leere MWST gleich Standard", () => {
    const r = parsePosItems("Name,Preis\nKaffee,\"4,80\"\nBier,6.5");
    expect(r.problems).toEqual([]);
    expect(r.rows.map((x) => [x.name, x.priceRappen, x.vatDineInBps, x.vatTakeawayBps])).toEqual([["Kaffee", 480, 810, 260], ["Bier", 650, 810, 260]]);
  });
  it("Fehler nennen die Zeile; ohne Pflichtspalten gibt es nur einen Fehler", () => {
    const r = parsePosItems("name;preis;mwst_haus\nA;abc;8.1\n;3;8.1\nC;3;99");
    expect(r.problems.map((p) => p.row)).toEqual([2, 3, 4]);
    expect(parsePosItems("foo;bar\n1;2").problems[0].message).toContain("name");
    expect(parsePosTables("x\n1").problems).toHaveLength(1);
  });
  it("Tische: doppelte Namen nur einmal, zu lange Namen sind Fehler", () => {
    expect(parsePosTables("tisch\n1\n1\n2").names).toEqual(["1", "2"]);
    expect(parsePosTables(`name\n${"x".repeat(31)}`).problems).toHaveLength(1);
  });
});
