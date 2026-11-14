import { vatOf } from "./invoice";

/**
 * Buchungsjournal für den Treuhänder (SPEC 18.3): Rechnungen und Zahlungen eines Zeitraums als Einzelbuchungen
 * (Soll-Konto, Haben-Konto, Betrag). Allgemeines CSV, kein Format eines bestimmten Programms; die Konten stellt das Hotel ein.
 * Beträge in Rappen. Negative Beträge werden zu positiven mit vertauschten Konten.
 */
export const ACCOUNT_KEYS = ["receivable", "revenueStay", "revenueExtra", "discount", "touristTax", "vat", "cash", "card", "twint", "bank", "stripe", "other"] as const;
export type AccountKey = (typeof ACCOUNT_KEYS)[number];
export type AccountMap = Record<AccountKey, string>;

export const ACCOUNT_LABEL: Record<AccountKey, string> = {
  receivable: "Debitoren (Forderungen aus Rechnungen)", revenueStay: "Ertrag Beherbergung", revenueExtra: "Ertrag übrige Leistungen (Frühstück, Extras)",
  discount: "Erlösminderung (Gutscheine, Rabatte)", touristTax: "Kurtaxe (Durchlaufposten / Verbindlichkeit)", vat: "Geschuldete MWST", cash: "Kasse", card: "Kartenzahlung (Terminal)",
  twint: "TWINT", bank: "Bank (Überweisung)", stripe: "Online-Zahlungen (Stripe)", other: "Andere Zahlungen",
};

// ASSUMPTION: Standardkonten nach dem Schweizer Kontenrahmen KMU, nur als Vorschlag; jedes Hotel passt sie mit dem Treuhänder an
export const DEFAULT_ACCOUNTS: AccountMap = {
  receivable: "1100", revenueStay: "3200", revenueExtra: "3400", discount: "3800", touristTax: "2300", vat: "2200",
  cash: "1000", card: "1021", twint: "1022", bank: "1020", stripe: "1023", other: "1029",
};

export const accountOk = (s: string) => /^[A-Za-z0-9._-]{1,20}$/.test(s);

export type JInvoice = {
  number: string; kind: "invoice" | "credit_note"; issuedOn: string; recipient: string; reference: string;
  lines: { category: string; vatBps: number; amountRappen: number }[];
};
export type JPayment = { date: string; reference: string; label: string; account: Exclude<AccountKey, "receivable">; amountRappen: number };
export type JRow = { date: string; doc: string; text: string; debit: string; credit: string; rappen: number; vat: string; ref: string };

function push(rows: JRow[], r: Omit<JRow, "debit" | "credit" | "rappen"> & { debit: string; credit: string; rappen: number }) {
  if (r.rappen === 0) return;
  rows.push(r.rappen < 0 ? { ...r, debit: r.credit, credit: r.debit, rappen: -r.rappen } : r);
}

export function buildJournal(invoices: JInvoice[], payments: JPayment[], a: AccountMap): JRow[] {
  const rows: JRow[] = [];
  for (const inv of invoices) {
    const doc = inv.number;
    const text = `${inv.kind === "credit_note" ? "Gutschrift" : "Rechnung"} ${inv.number} ${inv.recipient}`.trim();
    // Ertrag je Konto und Satz: Bruttobetrag, MWST-Anteil getrennt
    const groups = new Map<string, { account: string; bps: number; gross: number }>();
    for (const l of inv.lines) {
      const account = l.category === "stay" ? a.revenueStay : l.category === "tax" ? a.touristTax : l.category === "discount" ? a.discount : a.revenueExtra;
      const k = `${account}|${l.vatBps}`;
      const g = groups.get(k) ?? { account, bps: l.vatBps, gross: 0 };
      g.gross += l.amountRappen; groups.set(k, g);
    }
    for (const g of groups.values()) {
      const vat = vatOf(g.gross, g.bps);
      const vatCode = g.bps ? `${(g.bps / 100).toFixed(1)}` : "";
      push(rows, { date: inv.issuedOn, doc, text, debit: a.receivable, credit: g.account, rappen: g.gross - vat, vat: vatCode, ref: inv.reference });
      if (vat) push(rows, { date: inv.issuedOn, doc, text: `${text} MWST ${vatCode} %`, debit: a.receivable, credit: a.vat, rappen: vat, vat: "", ref: inv.reference });
    }
  }
  for (const p of payments) {
    push(rows, { date: p.date, doc: `Z-${p.reference}`, text: `Zahlung ${p.label} ${p.reference}`, debit: a[p.account], credit: a.receivable, rappen: p.amountRappen, vat: "", ref: p.reference });
  }
  return rows.sort((x, y) => x.date.localeCompare(y.date) || x.doc.localeCompare(y.doc));
}

const q = (s: string | number) => { const v = String(s); return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };

/** CSV: Semikolon, UTF-8 mit BOM, Datum JJJJ-MM-TT, Betrag mit Punkt */
export function journalCsv(rows: JRow[]): string {
  const head = ["Datum", "Beleg", "Text", "Soll", "Haben", "Betrag", "MWST-Satz %", "Referenz"];
  const body = rows.map((r) => [r.date, r.doc, r.text, r.debit, r.credit, (r.rappen / 100).toFixed(2), r.vat, r.ref].map(q).join(";"));
  return "﻿" + [head.join(";"), ...body].join("\r\n") + "\r\n";
}
