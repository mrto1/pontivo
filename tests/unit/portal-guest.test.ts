import { describe, expect, it } from "vitest";
import { STANDARD_WISHES, doorCodeEnabled, doorCodeVisible, folioEnabled, requestsEnabled, selfCheckoutEnabled, selfCheckoutOpen, wishLabel, wishOptions } from "../../src/domain/portal";

const base = {
  enabled: true, status: "active", validFrom: new Date("2026-12-24T13:00:00Z"), validUntil: new Date("2026-12-27T10:00:00Z"), now: new Date("2026-12-24T15:00:00Z"),
  today: "2026-12-24", checkin: "2026-12-24", checkout: "2026-12-27", checkinRequired: false, checkinDone: false, bookingConfirmed: true,
};

describe("Türcode im Gästeportal (SPEC 19.41)", () => {
  it("sichtbar im Gültigkeitsfenster ab Anreisetag", () => expect(doorCodeVisible(base)).toBe(true));
  it("nicht vor Gültigkeitsbeginn, nicht danach", () => {
    expect(doorCodeVisible({ ...base, now: new Date("2026-12-24T12:00:00Z") })).toBe(false);
    expect(doorCodeVisible({ ...base, now: new Date("2026-12-27T11:00:00Z") })).toBe(false);
  });
  it("nicht vor dem Anreisetag, auch wenn das Fenster früher beginnt", () => {
    expect(doorCodeVisible({ ...base, today: "2026-12-23", now: new Date("2026-12-24T13:30:00Z") })).toBe(false);
  });
  it("nur mit ausgefülltem Online-Check-in, wenn das Modul läuft", () => {
    expect(doorCodeVisible({ ...base, checkinRequired: true, checkinDone: false })).toBe(false);
    expect(doorCodeVisible({ ...base, checkinRequired: true, checkinDone: true })).toBe(true);
  });
  it("nicht bei widerrufenem Code, aus Einstellung oder unbestätigter Buchung", () => {
    expect(doorCodeVisible({ ...base, status: "revoked" })).toBe(false);
    expect(doorCodeVisible({ ...base, status: "pending" })).toBe(false);
    expect(doorCodeVisible({ ...base, enabled: false })).toBe(false);
    expect(doorCodeVisible({ ...base, bookingConfirmed: false })).toBe(false);
  });
});

describe("Einstellungen des Portals", () => {
  it("Standard: alles an, Standardwünsche", () => {
    expect([requestsEnabled(undefined), doorCodeEnabled(undefined), folioEnabled(undefined), selfCheckoutEnabled(undefined)]).toEqual([true, true, true, true]);
    expect(wishOptions(undefined)).toBe(STANDARD_WISHES);
    expect(requestsEnabled({ requests: false })).toBe(false);
  });
  it("Wunschbeschriftung mit Sprachfallback", () => {
    const o = { id: "x", label: { de: "Hund" } };
    expect(wishLabel(o, "de")).toBe("Hund");
    expect(wishLabel(o, "en")).toBeTruthy();
    expect(wishLabel(STANDARD_WISHES[0], "fr")).toContain("tardif");
  });
  it("Standardwünsche haben alle fünf Sprachen", () => {
    for (const w of STANDARD_WISHES) for (const l of ["de", "en", "fr", "it", "nl"] as const) expect(w.label[l].length).toBeGreaterThan(2);
  });
});

describe("Selbst-Check-out", () => {
  const b = { status: "confirmed", checkout: "2026-12-27", guestCheckoutAt: null as Date | null };
  it("nur am Abreisetag, bestätigt, einmal", () => {
    expect(selfCheckoutOpen(b, "2026-12-27", true)).toBe(true);
    expect(selfCheckoutOpen(b, "2026-12-26", true)).toBe(false);
    expect(selfCheckoutOpen(b, "2026-12-28", true)).toBe(false);
    expect(selfCheckoutOpen({ ...b, status: "cancelled" }, "2026-12-27", true)).toBe(false);
    expect(selfCheckoutOpen({ ...b, guestCheckoutAt: new Date() }, "2026-12-27", true)).toBe(false);
    expect(selfCheckoutOpen(b, "2026-12-27", false)).toBe(false);
  });
});
