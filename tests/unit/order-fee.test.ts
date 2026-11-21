import { describe, expect, it } from "vitest";
import { addMonths, flatForMonth, inIntro, introUntil, orderFee, orderPriceText, pilotUntilFor } from "../../src/domain/order-fee";

describe("Preis Online-Bestellung (SPEC 20.4)", () => {
  it("Monate addieren und Sonderangebot ohne angefangenen Startmonat", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2027-11-15", 3)).toBe("2028-02-15");
    expect(introUntil("2027-01-01")).toBe("2027-04-01");
    expect(introUntil("2027-01-10")).toBe("2027-05-01");
    expect(pilotUntilFor("2027-01-10")).toBe("2028-01-10");
  });

  it("Pauschale im Sonderangebot, danach 1,9 %; Modell «fixed» immer pauschal", () => {
    const s = { model: "percent" as const, startedOn: "2027-01-10", pilotUntil: null };
    expect(inIntro(s, "2027-04-30")).toBe(true);
    expect(inIntro(s, "2027-05-01")).toBe(false);
    expect(flatForMonth(s, "2027-04")).toBe(true);
    expect(flatForMonth(s, "2027-05")).toBe(false);
    expect(orderFee(s, "2027-04-30", 10_000, 190, 0)).toBe(0);
    expect(orderFee(s, "2027-05-01", 10_000, 190, 0)).toBe(190);
    expect(orderFee({ ...s, model: "fixed" }, "2029-01-01", 10_000, 190, 0)).toBe(0);
    expect(flatForMonth({ ...s, model: "fixed" }, "2029-01")).toBe(true);
    expect(orderFee({ ...s, startedOn: null }, "2027-01-10", 10_000, 190, 0)).toBe(190); // ohne Start: Normalpreis
  });

  it("Pilot: höchstens CHF 149 pro Monat, nur bis zum Ende der 12 Monate", () => {
    const s = { model: "percent" as const, startedOn: "2027-01-10", pilotUntil: "2028-01-10" };
    expect(orderFee(s, "2027-06-01", 10_000, 190, 14_800)).toBe(100);
    expect(orderFee(s, "2027-06-01", 10_000, 190, 14_900)).toBe(0);
    expect(orderFee(s, "2027-06-01", 10_000, 190, 0)).toBe(190);
    expect(orderFee(s, "2028-01-10", 10_000, 190, 20_000)).toBe(190);
  });

  it("Preisangabe für den Betrieb", () => {
    expect(orderPriceText({ model: "percent", startedOn: null, pilotUntil: null }, "2027-01-01", "1.9", 5900, 4)).toMatch(/Normalpreis 1\.9 %.*3 Monate.*CHF 59.*Pilotbetrieb.*CHF 149 pro Monat\.$/);
    expect(orderPriceText({ model: "percent", startedOn: null, pilotUntil: null }, "2027-01-01", "1.9", 5900, 4)).not.toMatch(/Plätze/);
    expect(orderPriceText({ model: "fixed", startedOn: "2027-01-10", pilotUntil: "2028-01-10" }, "2027-02-01", "1.9", 5900, 0)).toMatch(/^Sonderangebot mindestens bis 30\.04\.2027.*bis 09\.01\.2028 nie mehr als CHF 149/);
    expect(orderPriceText({ model: "percent", startedOn: "2027-01-10", pilotUntil: null }, "2027-06-01", "1.9", 5900, 0)).toBe("1.9 % pro Bestellung (auch bar, dann mit der Monatsrechnung).");
  });
});
