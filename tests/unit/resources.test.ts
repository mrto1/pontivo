import { describe, expect, it } from "vitest";
import { freeSeats, hhmm, parseHhmm, priceOf, slotsOf, validRange } from "../../src/domain/resources";

const sauna = { capacity: 4, slotMinutes: 60, openFrom: 600, openTo: 1200, priceRappen: 2000, pricePerPerson: true };
describe("Angebote vor Ort (SPEC 19.11)", () => {
  it("Zeit lesen und anzeigen", () => {
    expect(parseHhmm("08:30")).toBe(510);
    expect(parseHhmm("25:00")).toBeNull();
    expect(parseHhmm("8")).toBeNull();
    expect(hhmm(510)).toBe("08:30");
  });
  it("Zeitfenster im Raster", () => {
    expect(slotsOf(sauna)).toHaveLength(10);
    expect(slotsOf({ slotMinutes: 90, openFrom: 600, openTo: 800 })).toEqual([{ startMin: 600, endMin: 690 }, { startMin: 690, endMin: 780 }]);
  });
  it("gültiger Zeitraum", () => {
    expect(validRange(sauna, 600, 660)).toBe(true);
    expect(validRange(sauna, 600, 720)).toBe(true);
    expect(validRange(sauna, 630, 690)).toBe(false); // nicht im Raster
    expect(validRange(sauna, 540, 600)).toBe(false); // vor Öffnung
    expect(validRange(sauna, 1140, 1260)).toBe(false); // nach Schluss
    expect(validRange(sauna, 600, 600)).toBe(false);
    expect(validRange(sauna, 600, 650)).toBe(false);
  });
  it("freie Plätze: höchste gleichzeitige Belegung", () => {
    const taken = [{ startMin: 600, endMin: 660, persons: 2 }, { startMin: 660, endMin: 720, persons: 3 }];
    expect(freeSeats(sauna, taken, 600, 660)).toBe(2);
    expect(freeSeats(sauna, taken, 660, 720)).toBe(1);
    expect(freeSeats(sauna, taken, 600, 720)).toBe(1); // Spitze 3
    expect(freeSeats(sauna, taken, 720, 780)).toBe(4);
  });
  it("Preis: Fenster × Preis, pro Person", () => {
    expect(priceOf(sauna, 600, 720, 3)).toBe(2 * 2000 * 3);
    expect(priceOf({ ...sauna, pricePerPerson: false }, 600, 720, 3)).toBe(4000);
  });
});
