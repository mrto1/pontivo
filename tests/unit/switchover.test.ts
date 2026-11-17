import { describe, expect, it } from "vitest";
import { evaluateSwitchover, rollbackUntil, SWITCH_KEYS, type SwitchFacts } from "../../src/domain/switchover";
import { parallelBanner } from "../../src/domain/setup";
import { detectKind, parseGuests, parseVouchers } from "../../src/domain/import-csv";

const facts: SwitchFacts = { roomTypes: 2, ratePlansComplete: true, futureBookings: 12, importedFuture: 12, channexEnabled: false, stripeCharges: true, invoiceLast: 0, members: 1 };

describe("Umschalt-Checkliste", () => {
  it("Pflichtpunkte, Zähler Alt gegen Neu, Bestätigungen", () => {
    let r = evaluateSwitchover(facts, {});
    expect(r.items.map((i) => i.key)).toEqual([...SWITCH_KEYS]);
    expect(r.ready).toBe(false);
    expect(r.items.find((i) => i.key === "reservierungen")!.done).toBe(false); // Zahl der alten Software fehlt
    r = evaluateSwitchover(facts, { oldFuture: 12 });
    expect(r.items.find((i) => i.key === "reservierungen")!.done).toBe(true);
    r = evaluateSwitchover(facts, { oldFuture: 14 });
    expect(r.diff).toBe(-2);
    expect(r.items.find((i) => i.key === "reservierungen")).toMatchObject({ done: false, confirmable: true });
    const all = evaluateSwitchover(facts, { oldFuture: 14, confirmed: ["stammdaten", "reservierungen", "kanaele", "zahlungen", "rechnungsnummer", "team"] });
    expect(all.ready).toBe(true); // «altzugang» ist freiwillig
    // Stripe nicht aktiv: Zahlungen lassen sich nicht bestätigen
    const nostripe = evaluateSwitchover({ ...facts, stripeCharges: false }, { confirmed: ["zahlungen"] });
    expect(nostripe.items.find((i) => i.key === "zahlungen")).toMatchObject({ done: false, confirmable: false });
    // Rechnungsnummer: Zähler gesetzt = automatisch erledigt
    expect(evaluateSwitchover({ ...facts, invoiceLast: 1233 }, {}).items.find((i) => i.key === "rechnungsnummer")!.done).toBe(true);
  });
  it("Rückweg 30 Tage, Parallelbetrieb-Banner", () => {
    expect(rollbackUntil("2026-01-01T00:00:00Z").toISOString().slice(0, 10)).toBe("2026-01-31");
    expect(parallelBanner({ onboarding: { previousSoftware: "yes" } })?.kind).toBe("parallel");
    expect(parallelBanner({ onboarding: { previousSoftware: "yes", switchover: { switchedAt: "x" } } })).toBeNull();
    expect(parallelBanner({ onboarding: { previousSoftware: "none" } })).toBeNull();
    expect(parallelBanner({ onboarding: {} })).toBeNull();
  });
});

describe("Gäste und Gutscheine als CSV", () => {
  it("Art erkennen", () => {
    expect(detectKind("externe_nummer;anreise")).toBe("reservations");
    expect(detectKind("code;betrag;restwert;gueltig_bis")).toBe("vouchers");
    expect(detectKind("vorname;nachname")).toBe("guests");
  });
  it("Einwilligung nur mit Ja und Datum", () => {
    const r = parseGuests("vorname;nachname;email;marketing_einwilligung;einwilligung_am\nA;B;a@x.ch;ja;2026-01-05\nC;D;c@x.ch;ja;\nE;F;;nein;\nG;H;kaputt;;");
    expect(r.rows.map((x) => x.consent)).toEqual([true, false, false]);
    expect(r.warnings).toHaveLength(1);
    expect(r.problems).toHaveLength(1);
  });
  it("Gutscheine: Restwert höchstens Betrag", () => {
    const r = parseVouchers("code;betrag;restwert;gueltig_bis\ngs-1;100;40;2027-01-01\nGS-2;100;140;2027-01-01\nGS-3;100;0;morgen");
    expect(r.rows.map((x) => [x.code, x.remainingRappen])).toEqual([["GS-1", 4000]]);
    expect(r.problems).toHaveLength(2);
  });
});
