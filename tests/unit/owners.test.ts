import { describe, expect, it } from "vitest";
import { commissionOf, monthRevenue, overlap, statement, validMonth } from "../../src/domain/owners";

describe("Eigentümerabrechnung (SPEC 19.10)", () => {
  it("Umsatz nur der Nächte im Monat", () => {
    const n = [{ night: "2026-12-30", priceRappen: 10000 }, { night: "2026-12-31", priceRappen: 12000 }, { night: "2027-01-01", priceRappen: 15000 }];
    expect(monthRevenue(n, "2026-12")).toBe(22000);
    expect(monthRevenue(n, "2027-01")).toBe(15000);
    expect(monthRevenue(n, "2027-02")).toBe(0);
  });
  it("Kommission rundet auf Rappen, Auszahlung kann negativ sein", () => {
    expect(commissionOf(33333, 2000)).toBe(6667);
    expect(statement(100000, 2000, 5000)).toEqual({ revenueRappen: 100000, commissionRappen: 20000, costsRappen: 5000, netRappen: 75000 });
    expect(statement(0, 2000, 5000).netRappen).toBe(-5000);
  });
  it("Monat und Überschneidung", () => {
    expect(validMonth("2026-11")).toBe(true);
    expect(validMonth("2026-13")).toBe(false);
    expect(overlap(["a", "b"], [["b"], ["c"]])).toEqual(["b"]);
  });
});
