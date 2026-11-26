import { describe, expect, it } from "vitest";
import { aggregate } from "../../src/domain/dining-stats";

const d = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 20, h, m));
describe("aggregate", () => {
  const base = {
    tables: [{ id: "t1", name: "T1", waiterId: "w1" }, { id: "t2", name: "T2", waiterId: null }],
    waiters: [{ id: "w1", name: "Anna" }],
    orders: [{ id: "o1", tableId: "t1", openedAt: d(18) }, { id: "o2", tableId: "t2", openedAt: d(18) }, { id: "o3", tableId: "t1", openedAt: d(8) }],
    receipts: [
      { orderId: "o1", totalRappen: 4000, tipRappen: 400, paidAt: d(19, 30) },
      { orderId: "o2", totalRappen: 1000, tipRappen: 0, paidAt: d(18, 30) },
      { orderId: "o3", totalRappen: 500, tipRappen: 0, paidAt: d(23) }, // 15 h offen: zählt nicht zur Verweildauer
    ],
    reservations: [{ time: "18:00", party: 4, status: "confirmed" }, { time: "18:30", party: 2, status: "seated" }, { time: "19:00", party: 2, status: "noshow" }, { time: "19:00", party: 2, status: "cancelled" }],
    feedback: [{ stars: 5, comment: "" }, { stars: 2, comment: "kalt" }],
  };
  const s = aggregate(base);
  it("Umsatz, Trinkgeld, Kellner", () => {
    expect(s).toMatchObject({ totalRappen: 5500, tipRappen: 400, receipts: 3 });
    expect(s.tables[0]).toMatchObject({ id: "t1", revenueRappen: 4500, tipRappen: 400 });
    expect(s.waiters.map((w) => [w.name, w.revenueRappen])).toEqual([["Anna", 4500], ["Ohne Kellner", 1000]]);
  });
  it("Verweildauer ohne vergessene Bestellungen", () => {
    expect(s.tables.find((t) => t.id === "t1")!.avgStayMin).toBe(90);
    expect(s.avgStayMin).toBe(60);
  });
  it("Gäste je Stunde, No-show, Bewertung", () => {
    expect(s.guestsByHour).toEqual([{ hour: 18, guests: 6 }]);
    expect(s.reservations).toEqual({ total: 3, noShow: 1, noShowPct: 33.3 });
    expect(s.feedback).toMatchObject({ count: 2, avgStars: 3.5, low: [{ stars: 2, comment: "kalt" }] });
  });
});
