import { describe, expect, it } from "vitest";
import { evaluateOffer, validateStay, type RateRow } from "../../src/domain/availability";
import { quoteCancellation } from "../../src/domain/cancellation";
import { assertTransition, canTransition } from "../../src/domain/state-machine";
import { nightsOf, ageOn, zonedToUtc } from "../../src/domain/dates";
import { newReference, newPublicToken } from "../../src/domain/ids";

const room = { maxAdults: 2, maxChildren: 1, maxOccupancy: 3 };
const q = (checkin: string, checkout: string, adults = 2, children = 0) => ({ checkin, checkout, adults, children });
const inv = (nights: string[], free = 1) => nights.map((night) => ({ night, total: 5, booked: 5 - free, blocked: 0 }));
const rate = (night: string, o: Partial<RateRow> = {}): RateRow => ({
  night, priceRappen: 18000, minStayArrival: 1, maxStay: null, closedToArrival: false, closedToDeparture: false, stopSell: false, ...o,
});
const D = ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"];

describe("SPEC 5.1 Suche", () => {
  it("Nächte = checkin..checkout-1", () => {
    expect(nightsOf("2026-12-01", "2026-12-03")).toEqual(["2026-12-01", "2026-12-02"]);
  });
  it("ungültige Daten", () => {
    expect(validateStay(q("2026-12-02", "2026-12-02"), "2026-11-01")).toBe("invalid_dates");
    expect(validateStay(q("2026-10-02", "2026-10-03"), "2026-11-01")).toBe("in_past");
    expect(validateStay(q("2026-12-01", "2027-01-15"), "2026-11-01")).toBe("too_long");
  });
  it("ok", () => {
    expect(evaluateOffer(q(D[0], D[2]), room, inv(D), D.map((d) => rate(d))).ok).toBe(true);
  });
  it("Personenzahl", () => {
    expect(evaluateOffer(q(D[0], D[2], 3, 0), room, inv(D), D.map((d) => rate(d)))).toEqual({ ok: false, reason: "occupancy" });
    expect(evaluateOffer(q(D[0], D[2], 2, 2), room, inv(D), D.map((d) => rate(d)))).toEqual({ ok: false, reason: "occupancy" });
    expect(evaluateOffer(q(D[0], D[2], 2, 1), room, inv(D), D.map((d) => rate(d))).ok).toBe(true);
  });
  it("ausgebucht in einer Nacht", () => {
    const i = inv(D);
    i[1].booked = 5;
    expect(evaluateOffer(q(D[0], D[2]), room, i, D.map((d) => rate(d)))).toEqual({ ok: false, reason: "sold_out" });
  });
  it("Mindestnächte", () => {
    expect(evaluateOffer(q(D[0], D[1]), room, inv(D), [rate(D[0], { minStayArrival: 2 }), rate(D[1])])).toEqual({ ok: false, reason: "min_stay" });
    expect(evaluateOffer(q(D[0], D[2]), room, inv(D), [rate(D[0], { minStayArrival: 2 }), rate(D[1])]).ok).toBe(true);
  });
  it("Anreise gesperrt nur am Anreisetag", () => {
    expect(evaluateOffer(q(D[0], D[2]), room, inv(D), [rate(D[0], { closedToArrival: true }), rate(D[1])])).toEqual({ ok: false, reason: "closed_to_arrival" });
    expect(evaluateOffer(q(D[0], D[2]), room, inv(D), [rate(D[0]), rate(D[1], { closedToArrival: true })]).ok).toBe(true);
  });
  it("Abreise gesperrt", () => {
    expect(evaluateOffer(q(D[0], D[2]), room, inv(D), [rate(D[0]), rate(D[1]), rate(D[2], { closedToDeparture: true })])).toEqual({ ok: false, reason: "closed_to_departure" });
  });
  it("Verkaufsstopp", () => {
    expect(evaluateOffer(q(D[0], D[2]), room, inv(D), [rate(D[0]), rate(D[1], { stopSell: true })])).toEqual({ ok: false, reason: "stop_sell" });
  });
  it("max_stay", () => {
    expect(evaluateOffer(q(D[0], D[3]), room, inv(D), [rate(D[0], { maxStay: 2 }), rate(D[1]), rate(D[2])])).toEqual({ ok: false, reason: "max_stay" });
  });
  it("fehlende Zeile = nicht buchbar", () => {
    expect(evaluateOffer(q(D[0], D[2]), room, inv([D[0]]), D.map((d) => rate(d)))).toEqual({ ok: false, reason: "no_inventory" });
    expect(evaluateOffer(q(D[0], D[2]), room, inv(D), [rate(D[0])])).toEqual({ ok: false, reason: "no_rate" });
  });
});

describe("SPEC 5.7 Stornierung", () => {
  const base = { totalRappen: 37200, roomsTotalRappen: 36000, checkin: "2026-12-10", checkinTime: "15:00", timezone: "Europe/Zurich" };
  it("Frist = Check-in-Zeit Hotelzeit minus 48 h", () => {
    const deadline = zonedToUtc("2026-12-08", "15:00", "Europe/Zurich");
    expect(deadline.toISOString()).toBe("2026-12-08T14:00:00.000Z");
    const before = quoteCancellation({ ...base, freeCancelHours: 48, cancelFeeBps: 10000, now: new Date("2026-12-08T13:59:59Z") });
    expect(before).toMatchObject({ refundRappen: 37200, feeRappen: 0, free: true });
    const at = quoteCancellation({ ...base, freeCancelHours: 48, cancelFeeBps: 10000, now: new Date("2026-12-08T14:00:00Z") });
    expect(at.free).toBe(true);
    const after = quoteCancellation({ ...base, freeCancelHours: 48, cancelFeeBps: 10000, now: new Date("2026-12-08T14:00:01Z") });
    expect(after).toMatchObject({ refundRappen: 1200, feeRappen: 36000, free: false });
  });
  it("Teilgebühr", () => {
    expect(quoteCancellation({ ...base, freeCancelHours: 48, cancelFeeBps: 5000, now: new Date("2026-12-10T00:00:00Z") })).toMatchObject({ refundRappen: 19200, feeRappen: 18000 });
  });
  it("Nicht stornierbar: Kurtaxe zurück", () => {
    expect(quoteCancellation({ ...base, freeCancelHours: null, cancelFeeBps: 10000, now: new Date("2026-11-01T00:00:00Z") })).toMatchObject({ refundRappen: 1200 });
  });
  it("Hotel storniert: immer voll", () => {
    expect(quoteCancellation({ ...base, freeCancelHours: null, cancelFeeBps: 10000, now: new Date("2026-12-10T00:00:00Z"), byHotel: true }).refundRappen).toBe(37200);
  });
});

describe("SPEC 5.8 Zustandsautomat", () => {
  it("erlaubte Übergänge", () => {
    expect(canTransition("hold", "confirmed")).toBe(true);
    expect(canTransition("hold", "expired")).toBe(true);
    expect(canTransition("expired", "confirmed")).toBe(true);
    expect(canTransition("confirmed", "cancelled")).toBe(true);
    expect(canTransition("confirmed", "no_show")).toBe(true);
  });
  it("alles andere wirft", () => {
    for (const [a, b] of [["hold", "cancelled"], ["cancelled", "confirmed"], ["expired", "cancelled"], ["no_show", "confirmed"], ["confirmed", "hold"]] as const) {
      expect(() => assertTransition(a, b)).toThrow();
    }
  });
});

describe("IDs und Datum", () => {
  it("Referenz XXX-XXXX ohne verwechselbare Zeichen", () => {
    for (let i = 0; i < 200; i++) expect(newReference()).toMatch(/^[A-HJKMNP-Z2-9]{3}-[A-HJKMNP-Z2-9]{4}$/);
  });
  it("Token 32 Byte base64url", () => {
    expect(Buffer.from(newPublicToken(), "base64url").length).toBe(32);
  });
  it("Alter am Stichtag", () => {
    expect(ageOn("2016-12-10", "2026-12-09")).toBe(9);
    expect(ageOn("2016-12-10", "2026-12-10")).toBe(10);
  });
});

import { coverageIssue } from "../../src/domain/channex-readiness";
describe("Channex Anbindung: Preis-Abdeckung", () => {
  it("meldet fehlende und zu kurze Preise, sonst nichts", () => {
    expect(coverageIssue({ name: "BAR", pricedDays: 0, lastNight: null }, "2027-01-01")).toContain("keine Preise");
    expect(coverageIssue({ name: "BAR", pricedDays: 20, lastNight: "2027-01-21" }, "2027-01-01")).toContain("nur bis 21.01.2027");
    expect(coverageIssue({ name: "BAR", pricedDays: 200, lastNight: "2027-07-01" }, "2027-01-01")).toBeNull();
  });
});
