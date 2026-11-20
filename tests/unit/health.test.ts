import { describe, expect, it } from "vitest";
import { healthOf, type HealthSignals } from "../../src/domain/health";

const ok: HealthSignals = {
  status: "live", ageDays: 200, liveDays: 150, stripeChargesEnabled: true, hasCard: true, failedCharges: 0, bookings30: 12, bookingsPrev30: 10,
  horizonDays: 300, feedErrors: 0, channexErrors: 0, idleDays: 3, onboardingDone: true,
};

describe("Gesundheits-Ampel", () => {
  it("gesunder Betrieb ist grün", () => expect(healthOf(ok)).toEqual({ level: "green", reasons: [] }));

  it("rot: kann nicht verkaufen oder zahlt nicht", () => {
    expect(healthOf({ ...ok, stripeChargesEnabled: false }).level).toBe("red");
    expect(healthOf({ ...ok, failedCharges: 1 }).level).toBe("red");
    expect(healthOf({ ...ok, horizonDays: 5 }).level).toBe("red");
    expect(healthOf({ ...ok, channexErrors: 2 }).level).toBe("red");
  });

  it("gelb: nachfassen", () => {
    expect(healthOf({ ...ok, hasCard: false }).level).toBe("yellow");
    expect(healthOf({ ...ok, horizonDays: 40 }).reasons[0].text).toContain("40 Tage");
    expect(healthOf({ ...ok, feedErrors: 1 }).level).toBe("yellow");
    expect(healthOf({ ...ok, bookings30: 0, bookingsPrev30: 0 }).reasons[0].text).toContain("Keine Direktbuchung");
    expect(healthOf({ ...ok, bookings30: 2, bookingsPrev30: 10 }).reasons[0].text).toContain("halbiert");
    expect(healthOf({ ...ok, idleDays: 45 }).level).toBe("yellow");
    expect(healthOf({ ...ok, idleDays: null }).reasons[0].text).toContain("noch nichts");
  });

  it("neue Betriebe ohne Buchungen sind nicht gleich gelb", () => {
    expect(healthOf({ ...ok, liveDays: 10, bookings30: 0, bookingsPrev30: 0 }).level).toBe("green");
    expect(healthOf({ ...ok, bookings30: 1, bookingsPrev30: 3 }).level).toBe("green"); // zu wenig Daten für «halbiert»
  });

  it("Entwurf: Einrichtung offen nach 5 Tagen gelb, nach 14 rot; fertig = grün; pausiert = gelb", () => {
    const d = { ...ok, status: "draft", onboardingDone: false };
    expect(healthOf({ ...d, ageDays: 2 }).level).toBe("green");
    expect(healthOf({ ...d, ageDays: 6 }).level).toBe("yellow");
    expect(healthOf({ ...d, ageDays: 20 }).level).toBe("red");
    expect(healthOf({ ...d, ageDays: 20, onboardingDone: true }).level).toBe("green");
    expect(healthOf({ ...ok, status: "paused" }).level).toBe("yellow");
  });

  it("rot gewinnt vor gelb, alle Gründe bleiben sichtbar", () => {
    const h = healthOf({ ...ok, stripeChargesEnabled: false, hasCard: false });
    expect(h.level).toBe("red");
    expect(h.reasons).toHaveLength(2);
  });
});
