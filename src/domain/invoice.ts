/**
 * Rechnung (SPEC 16.3): reine Logik ohne I/O. Beträge in Rappen, Preise sind Bruttopreise (inkl. MWST).
 */
export type VatKind = "stay" | "standard" | "none";

export type InvoicingSettings = {
  vatLiable: boolean;
  vatNumber: string;
  /** Beherbergung (Sondersatz), Basispunkte. ASSUMPTION: 3,8 % (befristet, Stand prüfen) */
  stayBps: number;
  /** übrige Leistungen, Basispunkte (8,1 %) */
  standardBps: number;
  iban: string;
  /** optional: QR-IBAN des Kontos (dann QR-Referenz statt «NON») */
  qrIban: string;
  paymentDays: number;
  footer: string;
};

export const DEFAULT_INVOICING: InvoicingSettings = { vatLiable: false, vatNumber: "", stayBps: 380, standardBps: 810, iban: "", qrIban: "", paymentDays: 30, footer: "", };

/** Satz in Basispunkten für eine Art von Leistung; nicht MWST-pflichtig = 0 */
export function vatBps(s: InvoicingSettings, kind: VatKind): number {
  if (!s.vatLiable || kind === "none") return 0;
  return kind === "stay" ? s.stayBps : s.standardBps;
}

/** MWST-Anteil in einem Bruttobetrag: Betrag × Satz / (10000 + Satz), kaufmännisch gerundet (auch bei negativen Beträgen symmetrisch) */
export function vatOf(grossRappen: number, bps: number): number {
  if (bps === 0 || grossRappen === 0) return 0;
  const raw = (Math.abs(grossRappen) * bps) / (10_000 + bps);
  return Math.sign(grossRappen) * Math.round(raw);
}

export type VatLine = { amountRappen: number; vatBps: number };
export type VatRow = { bps: number; grossRappen: number; vatRappen: number; netRappen: number };

/** MWST pro Satz: gerundet wird pro Satz auf der Summe, nicht pro Zeile (so schreibt es die Rechnung aus) */
export function vatBreakdown(lines: VatLine[]): { rows: VatRow[]; totalRappen: number; vatRappen: number } {
  const by = new Map<number, number>();
  for (const l of lines) by.set(l.vatBps, (by.get(l.vatBps) ?? 0) + l.amountRappen);
  const rows = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([bps, gross]) => {
    const vat = vatOf(gross, bps);
    return { bps, grossRappen: gross, vatRappen: vat, netRappen: gross - vat };
  });
  return { rows, totalRappen: rows.reduce((a, r) => a + r.grossRappen, 0), vatRappen: rows.reduce((a, r) => a + r.vatRappen, 0) };
}

export const formatBps = (bps: number) => `${(bps / 100).toFixed(1).replace(".", ",")} %`;

// ---------------------------------------------------------------- IBAN und QR-Rechnung

export const cleanIban = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** IBAN-Prüfsumme (ISO 13616, Modulo 97) */
export function ibanValid(raw: string): boolean {
  const s = cleanIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** Schweizer/liechtensteinische IBAN (21 Zeichen), für die QR-Rechnung */
export const isSwissIban = (raw: string) => /^(CH|LI)\d{19}$/.test(cleanIban(raw)) && ibanValid(raw);

/** QR-IBAN (Institutskennung 30000–31999) braucht eine QR-Referenz (Referenztyp QRR) */
export function isQrIban(raw: string): boolean {
  const iid = Number(cleanIban(raw).slice(4, 9));
  return iid >= 30000 && iid <= 31999;
}

const MOD10 = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];

/** QR-Referenz (27 Ziffern): Rechnungsnummer nur als Ziffern, links mit Nullen auf 26 Stellen, plus Prüfziffer (Modulo 10 rekursiv) */
export function qrReference(invoiceNumber: string): string {
  const digits = invoiceNumber.replace(/\D/g, "");
  if (!digits || digits.length > 26) throw new Error("Rechnungsnummer ungeeignet für QR-Referenz");
  const body = digits.padStart(26, "0");
  let carry = 0;
  for (const d of body) carry = MOD10[(carry + Number(d)) % 10];
  return body + String((10 - carry) % 10);
}

/** Darstellung wie auf dem Zahlteil: 2 Ziffern, dann Gruppen zu 5 */
export const formatQrReference = (ref: string) => `${ref.slice(0, 2)} ${ref.slice(2).replace(/(.{5})/g, "$1 ").trim()}`;

export type QrAddress = { name: string; street?: string; zip: string; city: string; country: string };

const clip = (s: string | undefined, n: number) => (s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n);

/**
 * Inhalt des QR-Codes der QR-Rechnung (Swiss Payment Standards, Version 2.x, SPC 0200).
 * Konto = IBAN (Referenztyp NON; mit QR-IBAN und qrReference: QRR, Rechnungsnummer unter «Zusätzliche Informationen»); Betrag leer = offen.
 */
export function swissQrPayload(a: { iban: string; creditor: QrAddress; amountRappen: number | null; debtor?: QrAddress | null; message: string; qrReference?: string }): string {
  const addr = (x: QrAddress) => ["S", clip(x.name, 70), clip(x.street, 70), "", clip(x.zip, 16), clip(x.city, 35), clip(x.country, 2).toUpperCase()];
  const empty7 = ["", "", "", "", "", "", ""];
  const lines = [
    "SPC", "0200", "1", cleanIban(a.iban),
    ...addr(a.creditor),
    ...empty7,
    a.amountRappen === null ? "" : (a.amountRappen / 100).toFixed(2), "CHF",
    ...(a.debtor && a.debtor.name && a.debtor.zip && a.debtor.city ? addr(a.debtor) : empty7),
    a.qrReference ? "QRR" : "NON", a.qrReference ?? "", clip(a.message, 140),
    "EPD",
  ];
  return lines.join("\n");
}
