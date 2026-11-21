import { describe, expect, it } from "vitest";
import { salesByDay, salesCsv, salesTotal } from "../../src/domain/online-sales";

const r = (day: string, total: number, method: string, fee: number) => ({ day, totalRappen: total, feeRappen: fee, payments: [{ method, amountRappen: total }], vat: [{ bps: 260, grossRappen: total, vatRappen: Math.round(total * 260 / 10260), netRappen: total - Math.round(total * 260 / 10260) }] });

describe("Tagesabrechnung Online-Verkäufe (SPEC 20.8)", () => {
  it("je Tag summiert, Zahlart getrennt, Total über den Monat", () => {
    const days = salesByDay([r("2026-11-02", 3600, "card", 68), r("2026-11-01", 2000, "cash", 38), r("2026-11-02", 1000, "cash", 19)]);
    expect(days.map((d) => d.day)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(days[1]).toMatchObject({ count: 2, totalRappen: 4600, cardRappen: 3600, cashRappen: 1000, feeRappen: 87 });
    expect(days[1].vat).toHaveLength(1);
    const t = salesTotal(days);
    expect(t).toMatchObject({ count: 3, totalRappen: 6600, cardRappen: 3600, cashRappen: 3000, feeRappen: 125 });
    const csv = salesCsv(days);
    expect(csv.startsWith("﻿Datum;Bestellungen;Total")).toBe(true);
    expect(csv).toContain("2026-11-02;2;46.00;36.00;10.00;2.6;46.00;");
  });
});
