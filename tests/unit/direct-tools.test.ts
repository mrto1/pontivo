import { describe, expect, it } from "vitest";
import {
  applyDiscount, benefitText, benefitsFor, bestAdjustment, cleanBenefits, codeUsable, fillsGap, findGaps, gapSettings, normalizeCode, recoveryEnabled, waitlistEnabled,
} from "../../src/domain/direct-tools";

const nights = (spec: string, start = "2030-05-01") =>
  [...spec].map((c, i) => ({ night: new Date(Date.parse(start + "T00:00:00Z") + i * 86400000).toISOString().slice(0, 10), free: c === "." ? 1 : 0 }));

describe("Lücken", () => {
  // x = ausgebucht, . = frei
  const row = nights("xx..xxx.xx...xx");
  it("findet nur Lücken bis zur Höchstlänge, mit ausgebuchten Nachbarn", () => {
    expect(findGaps(row, "2030-01-01", 2)).toEqual([
      { from: "2030-05-03", to: "2030-05-05", nights: 2 },
      { from: "2030-05-08", to: "2030-05-09", nights: 1 },
    ]);
    expect(findGaps(row, "2030-01-01", 3).map((g) => g.nights)).toEqual([2, 1, 3]);
  });
  it("ignoriert Läufe am Rand und Lücken vor heute", () => {
    expect(findGaps(nights(".xx.x."), "2030-01-01", 2)).toEqual([{ from: "2030-05-04", to: "2030-05-05", nights: 1 }]);
    expect(findGaps(row, "2030-05-06", 3).map((g) => g.from)).toEqual(["2030-05-08", "2030-05-11"]);
  });
  it("fillsGap: nur wenn der Aufenthalt die Lücke genau füllt", () => {
    expect(fillsGap(row, "2030-05-03", "2030-05-05", 2)).toBe(true);
    expect(fillsGap(row, "2030-05-03", "2030-05-04", 2)).toBe(false); // danach noch frei
    expect(fillsGap(row, "2030-05-04", "2030-05-05", 2)).toBe(false); // davor noch frei
    expect(fillsGap(row, "2030-05-11", "2030-05-14", 2)).toBe(false); // länger als erlaubt
    expect(fillsGap(row, "2030-05-11", "2030-05-14", 3)).toBe(true);
    expect(fillsGap(nights("..xx"), "2030-05-01", "2030-05-03", 3)).toBe(false); // linker Nachbar unbekannt
  });
  it("Einstellungen mit Grenzen und Standardwerten", () => {
    expect(gapSettings(undefined)).toEqual({ enabled: false, maxNights: 2, discountBps: 0, relaxMinStay: true });
    expect(gapSettings({ gaps: { enabled: true, maxNights: 9, discountBps: 9999, relaxMinStay: false } })).toEqual({ enabled: true, maxNights: 3, discountBps: 3000, relaxMinStay: false });
  });
});

describe("Rabatt", () => {
  it("rundet auf Rappen, nie unter 1 Rappen, 0 = unverändert", () => {
    expect(applyDiscount(18000, 1000)).toBe(16200);
    expect(applyDiscount(9999, 1000)).toBe(8999);
    expect(applyDiscount(1, 5000)).toBe(1);
    expect(applyDiscount(18000, 0)).toBe(18000);
  });
  it("es gilt nur der höhere Rabatt", () => {
    expect(bestAdjustment([{ kind: "company", bps: 1000 }, { kind: "gap", bps: 1500 }])).toEqual({ kind: "gap", bps: 1500 });
    expect(bestAdjustment([null, { kind: "gap", bps: 0 }])).toBeNull();
  });
});

describe("Direktvorteile", () => {
  it("bereinigt: höchstens 4, Deutsch Pflicht, gekürzt, Mindestnächte", () => {
    const r = cleanBenefits([
      { text: { de: "  Late   Check-out  " } },
      { text: { en: "only english" } },
      { text: { de: "x".repeat(200) }, minNights: 3 },
      { text: { de: "a" } }, { text: { de: "b" } }, { text: { de: "c" } },
    ]);
    expect(r).toHaveLength(4);
    expect(r[0].text.de).toBe("Late Check-out");
    expect(r[1].text.de).toHaveLength(90);
    expect(r[1].minNights).toBe(3);
  });
  it("gilt ab Mindestnächten und nur wenn eingeschaltet", () => {
    const d = { benefits: { enabled: true, items: [{ id: "a", text: { de: "Frühstück" } }, { id: "b", text: { de: "Wein" }, minNights: 3 }] } };
    expect(benefitsFor(d, 2).map((b) => b.id)).toEqual(["a"]);
    expect(benefitsFor(d, 3).map((b) => b.id)).toEqual(["a", "b"]);
    expect(benefitsFor({ benefits: { ...d.benefits, enabled: false } }, 3)).toEqual([]);
    expect(benefitText({ de: "Wein", en: "Wine" }, "fr")).toBe("Wine"); // fr → en → de
  });
});

describe("Firmencode und Schalter", () => {
  it("normalisiert und prüft den Zeitraum", () => {
    expect(normalizeCode(" abc-123 ")).toBe("ABC-123");
    expect(normalizeCode("ab")).toBeNull();
    expect(normalizeCode("a b c d")).toBe("ABCD");
    expect(normalizeCode("ÄÖÜÄÖ")).toBeNull();
    const c = { active: true, validFrom: "2030-01-01", validUntil: "2030-12-31" };
    expect(codeUsable(c, "2030-06-01")).toBe(true);
    expect(codeUsable(c, "2029-12-31")).toBe(false);
    expect(codeUsable(c, "2031-01-01")).toBe(false);
    expect(codeUsable({ ...c, active: false }, "2030-06-01")).toBe(false);
  });
  it("Standard: Warteliste an, Abbruch-Mail aus", () => {
    expect(waitlistEnabled(undefined)).toBe(true);
    expect(waitlistEnabled({ waitlist: { enabled: false } })).toBe(false);
    expect(recoveryEnabled(undefined)).toBe(false);
    expect(recoveryEnabled({ recovery: { enabled: true } })).toBe(true);
  });
});
