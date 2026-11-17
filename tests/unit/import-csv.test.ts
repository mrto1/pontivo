import { describe, expect, it } from "vitest";
import { parseChf, parseCsv, parseDay, parseImport, toCsv } from "../../src/domain/import-csv";

describe("CSV für die Datenübernahme", () => {
  it("Trennzeichen, Anführungszeichen, BOM", () => {
    expect(parseCsv('﻿a;b\r\n"x;1";"he said ""hi"""\n')).toEqual([["a", "b"], ["x;1", 'he said "hi"']]);
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv(toCsv(["a", "b"], [["1;2", 'x"y']]))).toEqual([["a", "b"], ["1;2", 'x"y']]);
  });
  it("Beträge und Daten", () => {
    expect(parseChf("1'250.50")).toBe(125050);
    expect(parseChf("12,5")).toBe(1250);
    expect(parseChf("CHF 99")).toBe(9900);
    expect(parseChf("abc")).toBeNull();
    expect(parseDay("24.12.2026")).toBe("2026-12-24");
    expect(parseDay("2026-02-30")).toBeNull();
  });
  it("Pflichtspalten und Zeilenfehler", () => {
    expect(parseImport("a;b\n1;2").problems[0].message).toMatch(/Spalten fehlen/);
    const head = "externe_nummer;anreise;abreise;zimmertyp;vorname;nachname;preis_total;bezahlt";
    const r = parseImport(`${head}\nX1;2027-01-05;2027-01-04;DZ;A;B;100;0\nX2;2027-01-05;2027-01-07;DZ;A;B;100;200\nX3;2027-01-05;2027-01-07;DZ;A;B;100;0`);
    expect(r.rows.map((x) => x.ref)).toEqual(["X3"]);
    expect(r.problems.map((p) => p.row)).toEqual([2, 3]);
  });
});
