import { describe, expect, it } from "vitest";
import { proposePrice, validateRule, type Rule } from "../../src/domain/pricing-rules";

const rule: Rule = {
  baseRappen: 20000, minRappen: 15000, maxRappen: 30000,
  occupancySteps: [{ fromPct: 50, bps: 1000 }, { fromPct: 80, bps: 2500 }],
  lastMinute: { withinDays: 3, belowPct: 40, bps: -1500 },
  weekdayBps: [0, 0, 0, 0, 0, 1000, 1000],
};
const ctx = { occupancyPct: 0, leadDays: 30, weekday: 2, events: [] as { name: string; bps: number }[] };

describe("Preisregeln (SPEC 19.3)", () => {
  it("ohne zutreffende Regel bleibt es beim Basispreis", () => {
    const r = proposePrice(rule, ctx);
    expect(r.priceRappen).toBe(20000);
    expect(r.reason).toContain("Basispreis");
  });
  it("höchste passende Auslastungsstufe zählt, Wochentag und Ereignis addieren sich", () => {
    const r = proposePrice(rule, { ...ctx, occupancyPct: 85, weekday: 5, events: [{ name: "Messe", bps: 500 }] });
    expect(r.bps).toBe(2500 + 1000 + 500);
    expect(r.priceRappen).toBe(28000);
    expect(r.reason).toMatch(/Auslastung 85 % \(\+25 %\).*Freitag.*Messe/);
  });
  it("Last Minute nur bei geringer Auslastung und kurzer Frist", () => {
    expect(proposePrice(rule, { ...ctx, leadDays: 2, occupancyPct: 10 }).priceRappen).toBe(17000);
    expect(proposePrice(rule, { ...ctx, leadDays: 2, occupancyPct: 60 }).priceRappen).toBe(22000);
    expect(proposePrice(rule, { ...ctx, leadDays: 10, occupancyPct: 10 }).priceRappen).toBe(20000);
  });
  it("Minimum und Maximum begrenzen und werden begründet", () => {
    const hi = proposePrice(rule, { ...ctx, occupancyPct: 90, weekday: 6, events: [{ name: "Fest", bps: 5000 }] });
    expect(hi.priceRappen).toBe(30000);
    expect(hi.clamped).toBe("max");
    const lo = proposePrice({ ...rule, minRappen: 19000 }, { ...ctx, leadDays: 1, occupancyPct: 5 });
    expect(lo.priceRappen).toBe(19000);
    expect(lo.reason).toContain("Mindestpreis");
  });
  it("rundet auf ganze Franken und ist wiederholbar", () => {
    const c = { ...ctx, occupancyPct: 55 };
    expect(proposePrice({ ...rule, baseRappen: 18333 }, c).priceRappen % 100).toBe(0);
    expect(proposePrice(rule, c)).toEqual(proposePrice(rule, c));
  });
  it("prüft Eingaben", () => {
    expect(validateRule(rule)).toBeNull();
    expect(validateRule({ ...rule, maxRappen: 100 })).toMatch(/Höchstpreis/);
    expect(validateRule({ ...rule, baseRappen: 0 })).toMatch(/Basispreis/);
    expect(validateRule({ ...rule, weekdayBps: [0] })).toMatch(/Wochentag/);
    expect(validateRule({ ...rule, occupancySteps: [{ fromPct: 120, bps: 0 }] })).toMatch(/Auslastungsstufe/);
  });
});
