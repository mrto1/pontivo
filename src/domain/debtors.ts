/** Debitoren (SPEC 19.7): Alterung, Mahnstufen, Bankdatei (camt.054), reine Logik */
import { qrReference } from "./invoice";

export type Bucket = "not_due" | "d1_30" | "d31_60" | "d60_plus";
export const BUCKET_LABEL: Record<Bucket, string> = { not_due: "nicht fällig", d1_30: "1–30 Tage", d31_60: "31–60 Tage", d60_plus: "über 60 Tage" };

export function bucketOf(daysOverdue: number): Bucket {
  if (daysOverdue <= 0) return "not_due";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  return "d60_plus";
}

/** Tage nach Fälligkeit, ab denen die Stufe 1, 2, 3 fällig ist (Zahlungserinnerung, 1. und 2. Mahnung) */
export const DUNNING_AFTER_DAYS = [5, 20, 35] as const;
export const DUNNING_LABEL = ["", "Zahlungserinnerung", "1. Mahnung", "2. Mahnung"] as const;

/** Nächste fällige Stufe (1 bis 3) oder null; `lastLevel` = bisher höchste gesendete Stufe */
export function nextDunningLevel(daysOverdue: number, lastLevel: number): 1 | 2 | 3 | null {
  const next = lastLevel + 1;
  if (next > 3) return null;
  return daysOverdue >= DUNNING_AFTER_DAYS[next - 1] ? (next as 1 | 2 | 3) : null;
}

export type BankEntry = { dedupeKey: string; bookedOn: string; amountRappen: number; reference: string };

/**
 * Gutschriften (CRDT) aus einer camt.054-Datei (ISO 20022). Liest nur: Buchungsdatum, Betrag, Referenz (Strukturierte Referenz, QR-Referenz)
 * und die Bankreferenz für die Eindeutigkeit. Belastungen (DBIT) werden ignoriert.
 * ASSUMPTION: Standardelemente von camt.054 (Ntry, Amt, CdtDbtInd, BookgDt/Dt, AcctSvcrRef, CdtrRefInf/Ref); Namensräume werden ignoriert.
 */
export function parseCamt054(xml: string): BankEntry[] {
  const out: BankEntry[] = [];
  const entries = xml.match(/<(?:\w+:)?Ntry\b[\s\S]*?<\/(?:\w+:)?Ntry>/g) ?? [];
  const tag = (s: string, name: string) => s.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`))?.[1]?.trim() ?? "";
  entries.forEach((e, idx) => {
    if (tag(e, "CdtDbtInd") !== "CRDT") return;
    const amt = tag(e, "Amt");
    const m = amt.match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!m) return;
    const rappen = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
    const bookedOn = tag(tag(e, "BookgDt"), "Dt").slice(0, 10) || tag(tag(e, "ValDt"), "Dt").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookedOn) || rappen <= 0) return;
    const reference = tag(tag(e, "CdtrRefInf"), "Ref").replace(/\s+/g, "");
    const bankRef = tag(e, "AcctSvcrRef") || tag(e, "NtryRef");
    out.push({ dedupeKey: bankRef ? `ref:${bankRef}` : `n:${bookedOn}:${rappen}:${reference}:${idx}`, bookedOn, amountRappen: rappen, reference });
  });
  return out;
}

/** Findet unter den Rechnungsnummern die, deren QR-Referenz zur Zahlung passt */
export function matchByReference<T extends { number: string | null }>(reference: string, invoices: T[]): T | null {
  const ref = reference.replace(/\s+/g, "");
  if (!ref) return null;
  for (const i of invoices) {
    if (!i.number) continue;
    try {
      if (qrReference(i.number) === ref) return i;
    } catch { /* Nummer ungeeignet: kein Treffer */ }
  }
  return null;
}
