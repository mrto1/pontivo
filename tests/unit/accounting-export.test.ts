import { describe, expect, it } from "vitest";
import { accountOk, buildJournal, DEFAULT_ACCOUNTS, journalCsv } from "../../src/domain/accounting-export";

const A = DEFAULT_ACCOUNTS;

describe("Buchungsjournal (SPEC 18.3)", () => {
  it("Rechnung: Ertrag netto je Konto und Satz, MWST getrennt, Kurtaxe ohne MWST; Summe der Haben = Rechnungstotal", () => {
    const rows = buildJournal([{ number: "2026-0001", kind: "invoice", issuedOn: "2026-11-02", recipient: "Muster AG", reference: "BK-1", lines: [
      { category: "stay", vatBps: 380, amountRappen: 103800 }, { category: "extra", vatBps: 810, amountRappen: 10810 }, { category: "tax", vatBps: 0, amountRappen: 2000 },
    ] }], [], A);
    const stay = rows.find((r) => r.credit === A.revenueStay)!;
    expect(stay).toMatchObject({ debit: A.receivable, rappen: 100000, vat: "3.8" });
    expect(rows.find((r) => r.credit === A.vat && r.text.includes("3.8"))!.rappen).toBe(3800);
    expect(rows.find((r) => r.credit === A.revenueExtra)!.rappen).toBe(10000);
    expect(rows.find((r) => r.credit === A.touristTax)!.rappen).toBe(2000);
    expect(rows.reduce((a, r) => a + r.rappen, 0)).toBe(103800 + 10810 + 2000);
  });

  it("Gutschrift und Rückzahlung: negative Beträge werden zu positiven mit vertauschten Konten", () => {
    const rows = buildJournal([{ number: "2026-0002", kind: "credit_note", issuedOn: "2026-11-03", recipient: "", reference: "BK-1", lines: [{ category: "stay", vatBps: 0, amountRappen: -5000 }] }],
      [{ date: "2026-11-04", reference: "BK-1", label: "bar", account: "cash", amountRappen: -2000 }, { date: "2026-11-05", reference: "BK-1", label: "online", account: "stripe", amountRappen: 3000 }], A);
    expect(rows[0]).toMatchObject({ debit: A.revenueStay, credit: A.receivable, rappen: 5000 });
    expect(rows[1]).toMatchObject({ debit: A.receivable, credit: A.cash, rappen: 2000 });
    expect(rows[2]).toMatchObject({ debit: A.stripe, credit: A.receivable, rappen: 3000 });
  });

  it("Nullbeträge entfallen; CSV: Semikolon, Anführungszeichen, Punkt als Dezimaltrenner", () => {
    const rows = buildJournal([{ number: "N1", kind: "invoice", issuedOn: "2026-11-02", recipient: 'Muster; "AG"', reference: "", lines: [{ category: "stay", vatBps: 0, amountRappen: 0 }, { category: "extra", vatBps: 0, amountRappen: 12345 }] }], [], A);
    expect(rows).toHaveLength(1);
    const csv = journalCsv(rows);
    expect(csv.startsWith("﻿Datum;Beleg;Text;Soll;Haben;Betrag;MWST-Satz %;Referenz")).toBe(true);
    expect(csv).toContain('"Rechnung N1 Muster; ""AG"""');
    expect(csv).toContain(";123.45;");
  });

  it("Kontonummern prüfen", () => {
    expect(accountOk("1020")).toBe(true);
    expect(accountOk("3200.10")).toBe(true);
    expect(accountOk("")).toBe(false);
    expect(accountOk("10 20")).toBe(false);
    expect(accountOk("x".repeat(21))).toBe(false);
  });
});
