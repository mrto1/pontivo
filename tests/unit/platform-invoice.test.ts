import { describe, expect, it } from "vitest";
import { billMonth, cleanPlatformVat, invoiceNumber, monthEnd, vatApplies, vatOnNet } from "../../src/domain/platform-invoice";

describe("Rechnung an das Hotel", () => {
  it("Monatsende", () => {
    expect(monthEnd("2026-11")).toBe("2026-11-30");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
  });

  it("MWST gilt nach dem Leistungsmonat; nicht pflichtig = nie", () => {
    const v = { liableFrom: "2027-01-01", bps: 810, number: "CHE-1" };
    expect(vatApplies(v, "2026-12")).toBe(false);
    expect(vatApplies(v, "2027-01")).toBe(true);
    expect(vatApplies({ ...v, liableFrom: "2027-01-15" }, "2027-01")).toBe(true); // mitten im Monat: ganzer Monat
    expect(vatApplies({ ...v, liableFrom: null }, "2027-01")).toBe(false);
    expect(vatApplies({ ...v, bps: 0 }, "2027-01")).toBe(false);
  });

  it("MWST wird obendrauf gerechnet und kaufmännisch gerundet", () => {
    expect(vatOnNet(1900, 810)).toBe(154); // 153.9
    expect(vatOnNet(0, 810)).toBe(0);
  });

  it("Differenz zum Minimum, KI-Chat und MWST kommen von der Karte, Gebühren sind schon einbehalten", () => {
    // Gebühren unter dem Minimum
    expect(billMonth({ feesRappen: 500, minimumRappen: 1900, aiRappen: 0, vatBps: 0 })).toEqual({ netRappen: 1900, vatRappen: 0, grossRappen: 1900, withheldRappen: 500, payRappen: 1400, shortfallRappen: 1400 });
    // Gebühren über dem Minimum, ohne MWST: nichts zu belasten
    expect(billMonth({ feesRappen: 2500, minimumRappen: 1900, aiRappen: 0, vatBps: 0 }).payRappen).toBe(0);
    // mit MWST: auch bei bereits gedeckten Gebühren fällt MWST an
    const b = billMonth({ feesRappen: 2500, minimumRappen: 1900, aiRappen: 0, vatBps: 810 });
    expect(b).toMatchObject({ netRappen: 2500, vatRappen: 203, grossRappen: 2703, payRappen: 203 });
    // KI-Chat dazu
    const c = billMonth({ feesRappen: 0, minimumRappen: 1900, aiRappen: 1900, vatBps: 810 });
    expect(c).toMatchObject({ netRappen: 3800, vatRappen: 308, payRappen: 1900 + 1900 + 308 });
  });

  it("Eingaben prüfen", () => {
    expect(cleanPlatformVat({ liableFrom: "2027-01-01", bps: 810, number: " CHE-123.456.789  MWST " })).toEqual({ liableFrom: "2027-01-01", bps: 810, number: "CHE-123.456.789 MWST" });
    expect(cleanPlatformVat({ liableFrom: "", bps: 810 }).liableFrom).toBeNull();
    expect(() => cleanPlatformVat({ liableFrom: "01.01.2027", bps: 810, number: "x" })).toThrow();
    expect(() => cleanPlatformVat({ liableFrom: "2027-01-01", bps: 810, number: "" })).toThrow(/MWST-Nummer/);
    expect(() => cleanPlatformVat({ liableFrom: null, bps: 9999 })).toThrow();
  });

  it("Rechnungsnummer", () => expect(invoiceNumber(2026, 42)).toBe("R-2026-00042"));
});

describe("Plattformrechnung mit Online-Bestellungen (SPEC 20.4)", () => {
  it("bar bezahlte Gebühren und Gast-SMS kommen auf die Belastung", async () => {
    const { billMonth } = await import("../../src/domain/platform-invoice");
    const b = billMonth({ feesRappen: 3000, minimumRappen: 1900, aiRappen: 0, vatBps: 0, uncollectedRappen: 1000, smsRappen: 80 });
    expect(b.withheldRappen).toBe(2000);
    expect(b.netRappen).toBe(3080);
    expect(b.payRappen).toBe(1080); // nicht einbehalten + SMS, kein Minimum-Ausgleich
    const low = billMonth({ feesRappen: 500, minimumRappen: 1900, aiRappen: 0, vatBps: 0, uncollectedRappen: 500 });
    expect(low.payRappen).toBe(1400 + 500);
  });
});

describe("QR-Rechnung der Plattform (SPEC 20.6)", () => {
  it("Adresse für den Zahlteil zerlegen", async () => {
    const { splitAddress } = await import("../../src/domain/platform-invoice");
    expect(splitAddress("Konradstrasse 1, 8400 Winterthur")).toEqual({ street: "Konradstrasse 1", zip: "8400", city: "Winterthur" });
    expect(splitAddress("c/o Muster, Weg 2, CH-3000 Bern")).toEqual({ street: "c/o Muster, Weg 2", zip: "3000", city: "Bern" });
    expect(splitAddress("[Adresse]")).toBeNull();
  });
  it("Status in Worten und abrechenbar", async () => {
    const { billingReady, chargeStatusText } = await import("../../src/domain/platform-invoice");
    expect(billingReady({ billingMethod: "qr", billingPaymentMethodId: null })).toBe(true);
    expect(billingReady({ billingMethod: "card", billingPaymentMethodId: null })).toBe(false);
    expect(chargeStatusText({ status: "invoiced", attempts: 0, dueDate: "2026-12-31", dunningLevel: 0 }, "2026-12-01")).toEqual({ text: "offen, fällig 31.12.2026", warn: false });
    expect(chargeStatusText({ status: "invoiced", attempts: 0, dueDate: "2026-12-01", dunningLevel: 2 }, "2026-12-30")).toEqual({ text: "überfällig, fällig 01.12.2026 · 1. Mahnung", warn: true });
  });
});

describe("Online-Bestellung pauschal (SPEC 20.4)", () => {
  it("Pauschale kommt obendrauf und wird nicht an die Mindestgebühr angerechnet", async () => {
    const { billMonth } = await import("../../src/domain/platform-invoice");
    const b = billMonth({ feesRappen: 500, minimumRappen: 1900, aiRappen: 0, vatBps: 0, orderModuleRappen: 5900 });
    expect(b).toMatchObject({ netRappen: 1900 + 5900, shortfallRappen: 1400, payRappen: 1400 + 5900, withheldRappen: 500 });
  });
});

describe("Kasse als Zusatzmodul (Konzept 6)", () => {
  it("CHF 29 obendrauf, nicht an die Mindestgebühr angerechnet", async () => {
    const { billMonth, POS_MODULE_RAPPEN } = await import("../../src/domain/platform-invoice");
    const b = billMonth({ feesRappen: 2500, minimumRappen: 1900, aiRappen: 0, vatBps: 0, posModuleRappen: POS_MODULE_RAPPEN });
    expect(b).toMatchObject({ netRappen: 2500 + 2900, shortfallRappen: 0, payRappen: 2900 });
  });
});
