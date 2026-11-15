import { describe, expect, it } from "vitest";
import { splitGuests } from "../../src/domain/multiroom";

describe("Mehrzimmerbuchung: Personen verteilen (SPEC 19.6)", () => {
  it("verteilt gleichmässig, Kinder reihum samt Alter", () => {
    const s = splitGuests(5, 3, [4, 9, 12], 2)!;
    expect(s.map((r) => r.adults)).toEqual([3, 2]);
    expect(s.map((r) => r.children)).toEqual([2, 1]);
    expect(s[0].childrenAges).toEqual([4, 12]);
    expect(s[1].childrenAges).toEqual([9]);
  });
  it("jedes Zimmer braucht einen Erwachsenen; Grenzen", () => {
    expect(splitGuests(1, 2, [], 2)).toBeNull();
    expect(splitGuests(2, 0, [], 0)).toBeNull();
    expect(splitGuests(7, 0, [], 7)).toBeNull();
    expect(splitGuests(2, 0, [], 1)).toEqual([{ adults: 2, children: 0, childrenAges: [] }]);
  });
  it("Summe der Personen bleibt gleich", () => {
    const s = splitGuests(7, 4, [1, 2, 3, 4], 3)!;
    expect(s.reduce((a, r) => a + r.adults, 0)).toBe(7);
    expect(s.reduce((a, r) => a + r.children, 0)).toBe(4);
  });
});
