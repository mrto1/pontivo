/**
 * Rechnung der Plattform an das Hotel (SPEC 19.30), reine Logik ohne I/O.
 * Preise der Plattform verstehen sich ohne MWST (Bedingungen für Gastgeber, Ziffer 2): ist die Plattform MWST-pflichtig, kommt die MWST obendrauf.
 */
import { addDays, type Day } from "./dates";

export type PlatformVat = { /** MWST-pflichtig ab diesem Tag (Leistungsdatum); null = nicht pflichtig */ liableFrom: Day | null; bps: number; number: string };
export const DEFAULT_PLATFORM_VAT: PlatformVat = { liableFrom: null, bps: 810, number: "" };

export const MAX_VAT_BPS = 2500;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanPlatformVat(raw: { liableFrom?: string | null; bps?: number | string; number?: string }): PlatformVat {
  const from = String(raw.liableFrom ?? "").trim();
  if (from && (!DAY_RE.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)))) throw new Error("Datum ungültig (JJJJ-MM-TT)");
  const bps = Math.round(Number(raw.bps ?? DEFAULT_PLATFORM_VAT.bps));
  if (!Number.isFinite(bps) || bps < 0 || bps > MAX_VAT_BPS) throw new Error("MWST-Satz ungültig (0 bis 25 %)");
  const number = String(raw.number ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (from && !number) throw new Error("Für die MWST-Pflicht die MWST-Nummer eintragen (CHE-123.456.789 MWST)");
  return { liableFrom: (from || null) as Day | null, bps, number };
}

/** Letzter Tag eines Monats 'YYYY-MM' */
export function monthEnd(month: string): Day {
  const [y, m] = month.split("-").map(Number);
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01` as Day, -1);
}

/**
 * Gilt die MWST für die Leistungen des Monats? ASSUMPTION: Leistungsdatum = letzter Tag des Abrechnungsmonats;
 * beginnt die Pflicht mitten im Monat, gilt sie für den ganzen Monat.
 */
export function vatApplies(v: PlatformVat, month: string): boolean {
  return !!v.liableFrom && v.bps > 0 && monthEnd(month) >= v.liableFrom;
}

/** MWST auf einen Nettobetrag, kaufmännisch gerundet */
export const vatOnNet = (netRappen: number, bps: number) => Math.round((netRappen * bps) / 10_000);

export type MonthBilling = {
  /** Wert aller Leistungen ohne MWST */ netRappen: number;
  vatRappen: number;
  grossRappen: number;
  /** über Stripe schon einbehaltene Plattformgebühren */ withheldRappen: number;
  /** noch von der Karte zu belasten (inkl. MWST) */ payRappen: number;
  /** Differenz zur Mindestgebühr */ shortfallRappen: number;
};

/**
 * Monatsabrechnung: Gebühren (1,9 %) werden schon bei der Buchung über Stripe einbehalten, die Differenz zur Mindestgebühr,
 * der KI-Chat und die MWST kommen von der Karte.
 */
/**
 * `feesRappen`: alle verdienten Plattformgebühren des Monats; davon `uncollectedRappen` nicht über Stripe einbehalten (z. B. Online-Bestellung bar, SPEC 20.4).
 * `smsRappen`: weiterverrechnete Gast-SMS. Belastet wird: Differenz zum Minimum + nicht einbehaltene Gebühren + KI + SMS + MWST.
 */
export function billMonth(o: { feesRappen: number; minimumRappen: number; aiRappen: number; vatBps: number; uncollectedRappen?: number; smsRappen?: number; orderModuleRappen?: number }): MonthBilling {
  const uncollected = Math.min(o.uncollectedRappen ?? 0, o.feesRappen);
  const sms = (o.smsRappen ?? 0) + (o.orderModuleRappen ?? 0); // feste Beträge obendrauf, nicht an die Mindestgebühr angerechnet
  const base = Math.max(o.feesRappen, o.minimumRappen);
  const net = base + o.aiRappen + sms;
  const vat = o.vatBps > 0 ? vatOnNet(net, o.vatBps) : 0;
  const shortfall = Math.max(0, o.minimumRappen - o.feesRappen);
  return { netRappen: net, vatRappen: vat, grossRappen: net + vat, withheldRappen: o.feesRappen - uncollected, payRappen: shortfall + uncollected + o.aiRappen + sms + vat, shortfallRappen: shortfall };
}

export const invoiceNumber = (year: number, seq: number) => `R-${year}-${String(seq).padStart(5, "0")}`;

// ---------------------------------------------------------------- QR-Rechnung der Plattform (SPEC 20.6)

/** Zahlungsverbindung der Plattform: IBAN oder QR-IBAN, Zahlungsfrist in Tagen */
export type PlatformBilling = { iban: string; paymentDays: number };
export const DEFAULT_PLATFORM_BILLING: PlatformBilling = { iban: "", paymentDays: 30 };

/** Grundgebühr abrechenbar? Karte hinterlegt oder QR-Rechnung gewählt */
export const billingReady = (h: { billingMethod: "card" | "qr"; billingPaymentMethodId: string | null }) => h.billingMethod === "qr" || !!h.billingPaymentMethodId;

/** Neue Frist in einer Mahnung (Tage ab Versand) */
export const REMINDER_DAYS = 14; // Gastgeber-Bedingungen Ziffer 3: vor einer Pause Nachfrist von mindestens 14 Tagen

/** «Konradstrasse 1, 8400 Winterthur» → Strasse, PLZ, Ort (für den Zahlteil); ohne PLZ/Ort null */
export function splitAddress(raw: string): { street: string; zip: string; city: string } | null {
  const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
  const last = parts.pop() ?? "";
  const m = /^(?:CH-)?(\d{4})\s+(.+)$/.exec(last);
  if (!m) return null;
  return { street: parts.join(", "), zip: m[1], city: m[2] };
}

/** Status einer Plattform-Rechnung in Worten (Betrieb und Plattform-Verwaltung) */
export function chargeStatusText(c: { status: string; attempts: number; dueDate: string | null; dunningLevel: number }, today: string): { text: string; warn: boolean } {
  if (c.status === "succeeded") return { text: "bezahlt", warn: false };
  if (c.status === "none") return { text: "nichts fällig", warn: false };
  if (c.status === "pending") return { text: "offen (Karte)", warn: false };
  if (c.status === "failed") return { text: `fehlgeschlagen (${c.attempts}×)`, warn: true };
  const due = c.dueDate ? `${c.dueDate.slice(8, 10)}.${c.dueDate.slice(5, 7)}.${c.dueDate.slice(0, 4)}` : "";
  const level = ["", "Zahlungserinnerung", "1. Mahnung", "2. Mahnung"][c.dunningLevel] ?? "";
  const overdue = !!c.dueDate && c.dueDate < today;
  return { text: `${overdue ? "überfällig" : "offen"}, fällig ${due}${level ? ` · ${level}` : ""}`, warn: overdue };
}

// ---------------------------------------------------------------- Online-Bestellung: Preismodell (SPEC 20.4, Entscheid 21.11.2026)

/** Feste Monatspauschale der Online-Bestellung, solange die ESTV die Plattformfrage (Art. 20a MWSTG) nicht geklärt hat */
export const ORDER_MODULE_RAPPEN = 5900;
/** «fixed» = CHF 59 pro Monat, keine Gebühr pro Bestellung; «percent» = Plattformgebühr (1,9 %) pro Bestellung. Ziel: «percent», sobald die ESTV es bestätigt. */
export type OrderFeeModel = "fixed" | "percent";
