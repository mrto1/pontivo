import type { JRow } from "./accounting-export";

/**
 * Abacus-Export (SPEC 18.3a): Schnittstelle «FIBU – ASCII Buchungen», Version 2012.00, Mapping AbaDefault
 * (Abacus-Dokumentation, 64 Felder). Je Journalzeile eine Einzelbuchung (Account = Soll, Account2 = Haben, DebitCredit = D),
 * MWST steht als eigene Buchung auf dem MWST-Konto (wie im allgemeinen Journal), darum Steuermethode 0 ohne Steuerfelder.
 * ASSUMPTION: Die Dokumentation legt nur die Felder fest, nicht die Dateiform. Wir schreiben alle 64 Felder in der
 * dokumentierten Reihenfolge, Semikolon, UTF-8, Punkt als Dezimaltrenner, Datum JJJJ-MM-TT, mit Kopfzeile der Elementnamen.
 * Version «J» (die neueste in der Doku genannte). Mit einer Testdatei im Abacus des Treuhänders prüfen.
 */
export const ABACUS_FIELDS = [
  "RecordNumber", "Version", "Date", "Account", "Account2", "Text1", "KeyAmount", "Text2", "DebitCredit", "BookingLevel1",
  "ContraBookingLevel1", "DocumentNumber", "ExchangeRate", "ExchangeType", "ForeignAmount", "CollectiveEntryType", "Specification1", "Specification2", "Reserve001", "ValueDate",
  "CollectiveLineItem", "Reserve002", "ClientNumber", "ISO", "ISO2", "Quantity", "Rate", "BookingLevel2", "ContraBookingLevel2", "Fund1",
  "Fund2", "Reserve003", "Reserve004", "Reserve005", "CodeField", "TaxCode", "TaxRate", "TaxIncluded", "TaxMethod", "TaxCountry",
  "TaxCoefficient", "TaxAccount", "TaxAccount2", "TaxDebitCredit", "TaxKeyAmount", "TaxForeignAmount", "TaxKeyAmountRest", "TaxForeignAmountRest", "Reserve006", "TaxType",
  "Reserve007", "Reserve008", "Reserve009", "Division", "AmountType", "CreditCollectiveKeyAmount", "CreditCollectiveForeignAmount", "EuroCoefficient1", "EuroCoefficient2", "Intercompany",
  "ExchangeRate2", "ConsolidationCode", "BookingLevel3", "ContraBookingLevel3",
] as const;

export const abacusAccountOk = (s: string) => /^\d{1,11}$/.test(s);

/** Konten, die Abacus nicht annimmt (nur Ziffern, höchstens 11) */
export function abacusAccountProblems(rows: JRow[]): string[] {
  return [...new Set(rows.flatMap((r) => [r.debit, r.credit]).filter((a) => !abacusAccountOk(a)))];
}

const q = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const clip = (s: string, n: number) => s.replace(/[\r\n]+/g, " ").slice(0, n);

export function abacusCsv(rows: JRow[], opts: { currency?: string; clientNumber?: string } = {}): string {
  const cur = opts.currency ?? "CHF";
  const lines = rows.map((r, i) => {
    const v: Record<string, string> = {
      RecordNumber: String(i + 1), Version: "J", Date: r.date, Account: r.debit, Account2: r.credit, Text1: clip(r.text, 80), KeyAmount: (r.rappen / 100).toFixed(2),
      Text2: clip(r.ref, 80), DebitCredit: "D", DocumentNumber: clip(r.doc, 10), CollectiveEntryType: "S", ClientNumber: opts.clientNumber ?? "", ISO: cur, ISO2: cur, Quantity: "0",
      TaxRate: "0", TaxMethod: "0", TaxCoefficient: "100", TaxAccount: "0", TaxAccount2: "0", TaxDebitCredit: "0", TaxKeyAmount: "0", TaxForeignAmount: "0",
      TaxKeyAmountRest: "0", TaxForeignAmountRest: "0", TaxType: "1",
    };
    return ABACUS_FIELDS.map((f) => q(v[f] ?? "")).join(";");
  });
  return "﻿" + [ABACUS_FIELDS.join(";"), ...lines].join("\r\n") + "\r\n";
}
