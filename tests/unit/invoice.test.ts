import { describe, expect, it } from "vitest";
import { DEFAULT_INVOICING, ibanValid, isQrIban, isSwissIban, qrReference, formatQrReference, swissQrPayload, vatBps, vatBreakdown, vatOf } from "../../src/domain/invoice";

describe("MWST", () => {
  it("Anteil im Bruttobetrag", () => {
    expect(vatOf(10810, 810)).toBe(810); // 108.10 inkl. 8.1 % = 8.10
    expect(vatOf(10380, 380)).toBe(380);
    expect(vatOf(0, 810)).toBe(0);
    expect(vatOf(10000, 0)).toBe(0);
    expect(vatOf(-10810, 810)).toBe(-810); // Gutschrift symmetrisch
  });
  it("Sätze: nicht MWST-pflichtig = 0, Beherbergung/übrige/keine", () => {
    const s = { ...DEFAULT_INVOICING, vatLiable: true };
    expect(vatBps(DEFAULT_INVOICING, "stay")).toBe(0);
    expect(vatBps(s, "stay")).toBe(380);
    expect(vatBps(s, "standard")).toBe(810);
    expect(vatBps(s, "none")).toBe(0);
  });
  it("Aufschlüsselung pro Satz; Summe der Brutto-Beträge bleibt exakt", () => {
    const b = vatBreakdown([
      { amountRappen: 20760, vatBps: 380 }, { amountRappen: 10000, vatBps: 380 },
      { amountRappen: 5405, vatBps: 810 }, { amountRappen: 800, vatBps: 0 },
    ]);
    expect(b.rows.map((r) => r.bps)).toEqual([0, 380, 810]);
    expect(b.totalRappen).toBe(20760 + 10000 + 5405 + 800);
    for (const r of b.rows) expect(r.netRappen + r.vatRappen).toBe(r.grossRappen);
    expect(b.vatRappen).toBe(vatOf(30760, 380) + vatOf(5405, 810));
  });
});

describe("IBAN und QR-Rechnung", () => {
  const IBAN = "CH93 0076 2011 6238 5295 7"; // Beispiel-IBAN aus der Dokumentation
  it("Prüfsumme", () => {
    expect(ibanValid(IBAN)).toBe(true);
    expect(ibanValid("CH93 0076 2011 6238 5295 8")).toBe(false);
    expect(isSwissIban(IBAN)).toBe(true);
    expect(isSwissIban("DE89370400440532013000")).toBe(false);
    expect(isQrIban(IBAN)).toBe(false);
    expect(isQrIban("CH4431999123000889012")).toBe(true);
  });
  it("Payload: feste Zeilenstruktur (SPC 0200), Betrag, Schuldner, Nachricht", () => {
    const p = swissQrPayload({ iban: IBAN, creditor: { name: "Hotel Test", street: "Seestrasse 1", zip: "8750", city: "Glarus", country: "ch" }, amountRappen: 12345, debtor: { name: "Anna Muster", street: "Weg 2", zip: "8000", city: "Zürich", country: "CH" }, message: "Rechnung 2026-0001" });
    const l = p.split("\n");
    expect(l.slice(0, 4)).toEqual(["SPC", "0200", "1", "CH9300762011623852957"]);
    expect(l[4]).toBe("S");
    expect(l[10]).toBe("CH");
    expect(l.slice(11, 18)).toEqual(["", "", "", "", "", "", ""]); // abweichender Zahlungsempfänger leer
    expect(l[18]).toBe("123.45");
    expect(l[19]).toBe("CHF");
    expect(l[20]).toBe("S");
    expect(l[21]).toBe("Anna Muster");
    expect(l[27]).toBe("NON");
    expect(l[29]).toBe("Rechnung 2026-0001");
    expect(l[30]).toBe("EPD");
    expect(l).toHaveLength(31);
  });
  it("ohne Schuldneradresse und ohne Betrag: leere Felder", () => {
    const l = swissQrPayload({ iban: IBAN, creditor: { name: "H", zip: "1", city: "X", country: "CH" }, amountRappen: null, message: "" }).split("\n");
    expect(l[18]).toBe("");
    expect(l.slice(20, 27)).toEqual(["", "", "", "", "", "", ""]);
    expect(l).toHaveLength(31);
  });
});

describe("QR-Referenz", () => {
  it("27 Ziffern mit korrekter Prüfziffer (Beispiel aus dem SIX-Standard)", () => {
    expect(qrReference("21000000000313947143000901")).toBe("210000000003139471430009017");
    const ref = qrReference("2026-0001");
    expect(ref).toHaveLength(27);
    expect(ref.slice(0, 26)).toBe("00000000000000000020260001");
    expect(formatQrReference("210000000003139471430009017")).toBe("21 00000 00003 13947 14300 09017");
  });
  it("QRR im Payload mit QR-IBAN", () => {
    const l = swissQrPayload({ iban: "CH4431999123000889012", creditor: { name: "H", zip: "3000", city: "Bern", country: "CH" }, amountRappen: 100, message: "x", qrReference: qrReference("2026-0001") }).split("\n");
    expect(l[27]).toBe("QRR");
    expect(l[28]).toBe(qrReference("2026-0001"));
  });
});
