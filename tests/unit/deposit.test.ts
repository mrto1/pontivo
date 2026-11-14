import { describe, expect, it } from "vitest";
import { feeShare, planPayment } from "../../src/domain/deposit";

const h = (bps: number, days = 7) => ({ depositBps: bps, balanceDueDays: days });

describe("Anzahlung berechnen", () => {
  it("aus (100 %) oder nichts zu zahlen: volle Zahlung", () => {
    expect(planPayment(h(10000), 100000, "2027-03-20", "2027-01-01")).toEqual({ kind: "full" });
    expect(planPayment(h(3000), 0, "2027-03-20", "2027-01-01")).toEqual({ kind: "full" });
  });
  it("30 % bei Buchung, Rest 7 Tage vor Anreise", () => {
    expect(planPayment(h(3000), 100000, "2027-03-20", "2027-01-01")).toEqual({ kind: "deposit", depositRappen: 30000, balanceRappen: 70000, balanceDueOn: "2027-03-13" });
  });
  it("Anreise zu nah (bis und mit Fälligkeitsfrist): alles sofort", () => {
    expect(planPayment(h(3000), 100000, "2027-03-20", "2027-03-13")).toEqual({ kind: "full" });
    expect(planPayment(h(3000), 100000, "2027-03-20", "2027-03-14").kind).toBe("full");
    expect(planPayment(h(3000), 100000, "2027-03-20", "2027-03-12").kind).toBe("deposit");
  });
  it("winziger Rest: lieber gleich voll; Rundung ergibt immer die Summe", () => {
    expect(planPayment(h(9500), 15000, "2027-03-20", "2027-01-01")).toEqual({ kind: "full" }); // Rest 7.50
    for (const total of [12345, 99999, 33333, 100001]) {
      const p = planPayment(h(3333), total, "2027-06-01", "2027-01-01");
      expect(p.kind === "deposit" && p.depositRappen + p.balanceRappen).toBe(total);
    }
  });
  it("Plattformgebühr: Anzahlung + Rest = Gesamtgebühr", () => {
    for (const [fee, total, dep] of [[1900, 100000, 30000], [333, 9999, 3000], [1, 100, 30]] as const) {
      expect(feeShare(fee, total, dep) + (fee - feeShare(fee, total, dep))).toBe(fee);
    }
    expect(feeShare(1900, 100000, 30000)).toBe(570);
    expect(feeShare(0, 0, 0)).toBe(0);
  });
});
