import { describe, expect, it } from "vitest";
import { easterSunday, holidaysFor, parseSchoolHolidaysCsv, suggestions } from "../../src/domain/holidays";

describe("Feiertage", () => {
  it("Ostern stimmt für bekannte Jahre", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
  });
  it("bewegliche Feiertage 2027 (Ostern 28.3.)", () => {
    const h = Object.fromEntries(holidaysFor(2027, "ZH").map((x) => [x.name, x.day]));
    expect(h["Karfreitag"]).toBe("2027-03-26");
    expect(h["Ostermontag"]).toBe("2027-03-29");
    expect(h["Auffahrt"]).toBe("2027-05-06");
    expect(h["Pfingstmontag"]).toBe("2027-05-17");
    expect(h["Fronleichnam"]).toBeUndefined();
  });
  it("katholische Kantone bekommen Fronleichnam und Allerheiligen, TI kein Karfreitag, GE kein Stephanstag", () => {
    const lu = holidaysFor(2027, "LU").map((x) => x.name);
    expect(lu).toContain("Fronleichnam"); expect(lu).toContain("Allerheiligen");
    expect(holidaysFor(2027, "TI").map((x) => x.name)).not.toContain("Karfreitag");
    expect(holidaysFor(2027, "GE").map((x) => x.name)).not.toContain("Stephanstag");
  });
});

describe("Schulferien-Import", () => {
  it("liest Kopfzeile, Trennzeichen, TT.MM.JJJJ und meldet Fehler je Zeile", () => {
    const { rows, errors } = parseSchoolHolidaysCsv("Kanton;Name;von;bis\nzh;Herbstferien;2027-10-02;2027-10-17\nBE,Sportferien,01.02.2027,14.02.2027\nXX;Foo;2027-01-01;2027-01-02\nZH;Bar;2027-02-10;2027-02-01\nZH;;2027-01-01;2027-01-02");
    expect(rows).toEqual([
      { canton: "ZH", name: "Herbstferien", fromDay: "2027-10-02", toDay: "2027-10-17" },
      { canton: "BE", name: "Sportferien", fromDay: "2027-02-01", toDay: "2027-02-14" },
    ]);
    expect(errors).toHaveLength(3);
  });
});

describe("Vorschläge", () => {
  const school = [{ canton: "ZH", name: "Herbstferien", fromDay: "2027-10-02", toDay: "2027-10-17" }, { canton: "BE", name: "Herbstferien", fromDay: "2027-10-02", toDay: "2027-10-17" }];
  it("nur Zeitraum und Kanton, ohne vorhandene Ereignisse, nach Datum sortiert", () => {
    const s = suggestions("ZH", "2027-03-01", "2027-12-31", school, [{ name: "Auffahrt", fromDay: "2027-05-06" }]);
    const names = s.map((x) => x.name);
    expect(names).not.toContain("Auffahrt");
    expect(names).toContain("Pfingstmontag");
    expect(names).toContain("Herbstferien (ZH)");
    expect(names.some((n) => n.includes("(BE)"))).toBe(false);
    expect(s.map((x) => x.fromDay)).toEqual([...s.map((x) => x.fromDay)].sort());
  });
  it("Jahreswechsel liefert Feiertage beider Jahre", () => {
    const s = suggestions("ZH", "2027-12-01", "2028-01-31", [], []);
    expect(s.map((x) => x.fromDay)).toEqual(["2027-12-25", "2027-12-26", "2028-01-01"]);
  });
});
