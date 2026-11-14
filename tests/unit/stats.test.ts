import { describe, expect, it } from "vitest";
import { computeStats, kpi } from "../../src/domain/stats";

const types = [{ id: "a", name: "Doppel", count: 2 }, { id: "b", name: "Suite", count: 1 }];

describe("Kennzahlen", () => {
  it("kpi rundet und teilt nie durch 0", () => {
    expect(kpi(0, 0, 0)).toEqual({ available: 0, sold: 0, revenueRappen: 0, occupancyPct: 0, adrRappen: 0, revparRappen: 0 });
    expect(kpi(3, 30000, 10)).toMatchObject({ occupancyPct: 30, adrRappen: 10000, revparRappen: 3000 });
  });

  it("Zeitraum Januar (31 Tage), 3 Zimmer: Belegung, ADR, RevPAR, Herkunft, Typ", () => {
    const rows = [
      { night: "2027-01-01", roomTypeId: "a", source: "direct", priceRappen: 10000 },
      { night: "2027-01-02", roomTypeId: "a", source: "direct", priceRappen: 12000 },
      { night: "2027-01-02", roomTypeId: "b", source: "booking_com", priceRappen: 20000 },
      { night: "2026-12-31", roomTypeId: "a", source: "direct", priceRappen: 99999 }, // ausserhalb
      { night: "2027-02-01", roomTypeId: "a", source: "direct", priceRappen: 99999 }, // ausserhalb (to exklusiv)
    ];
    const r = computeStats(rows, types, "2027-01-01", "2027-02-01");
    expect(r.total).toMatchObject({ available: 93, sold: 3, revenueRappen: 42000, adrRappen: 14000, revparRappen: 452 });
    expect(r.total.occupancyPct).toBe(3.2);
    expect(r.byMonth).toHaveLength(1);
    expect(r.bySource).toEqual([{ source: "direct", sold: 2, revenueRappen: 22000, sharePct: 66.7 }, { source: "booking_com", sold: 1, revenueRappen: 20000, sharePct: 33.3 }]);
    expect(r.byType.find((t) => t.id === "b")).toMatchObject({ available: 31, sold: 1, adrRappen: 20000 });
  });

  it("mehrere Monate: Tage pro Monat stimmen (Februar 28)", () => {
    const r = computeStats([], types, "2027-01-01", "2027-03-01");
    expect(r.byMonth.map((m) => [m.month, m.available])).toEqual([["2027-01", 93], ["2027-02", 84]]);
  });
});
