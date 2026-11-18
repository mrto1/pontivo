import { describe, expect, it } from "vitest";
import { DEFAULT_INVOICING } from "../../src/domain/invoice";
import { lineTotal, offerNumber, offerOpen, offerTotals } from "../../src/domain/offers";

describe("Angebote (SPEC 19.21)", () => {
  it("Summen mit MWST je Satz; ohne MWST-Pflicht kein Ausweis", () => {
    const lines = [
      { description: "Raum", quantity: 1, unitRappen: 50_000, vatKind: "standard" as const },
      { description: "Kaffeepause", quantity: 20, unitRappen: 800, vatKind: "standard" as const },
      { description: "Zimmer", quantity: 2, unitRappen: 15_000, vatKind: "stay" as const },
    ];
    expect(lineTotal(lines[1])).toBe(16_000);
    const liable = offerTotals(lines, { ...DEFAULT_INVOICING, vatLiable: true });
    expect(liable.totalRappen).toBe(96_000);
    expect(liable.rows.map((r) => r.bps)).toEqual([380, 810]);
    expect(liable.vatRappen).toBeGreaterThan(0);
    expect(offerTotals(lines, DEFAULT_INVOICING).vatRappen).toBe(0);
  });
  it("offen nur gesendet und innerhalb der Gültigkeit (letzter Tag zählt)", () => {
    expect(offerOpen({ status: "sent", validUntil: "2026-12-01" }, "2026-12-01")).toBe(true);
    expect(offerOpen({ status: "sent", validUntil: "2026-12-01" }, "2026-12-02")).toBe(false);
    expect(offerOpen({ status: "draft", validUntil: "2026-12-01" }, "2026-11-01")).toBe(false);
    expect(offerOpen({ status: "accepted", validUntil: "2026-12-01" }, "2026-11-01")).toBe(false);
  });
  it("Nummer", () => expect(offerNumber(7, "2026")).toBe("A-2026-0007"));
});
