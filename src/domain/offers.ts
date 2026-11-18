import { vatBps, vatBreakdown, type InvoicingSettings, type VatKind } from "./invoice";

/** Angebote (SPEC 19.21): Summen und Gültigkeit, reine Logik. Preise brutto in Rappen, MWST wie bei Rechnungen. */
export type OfferLineLike = { description: string; quantity: number; unitRappen: number; vatKind: VatKind };

export const lineTotal = (l: Pick<OfferLineLike, "quantity" | "unitRappen">) => l.quantity * l.unitRappen;

export function offerTotals(lines: OfferLineLike[], s: InvoicingSettings) {
  return vatBreakdown(lines.map((l) => ({ amountRappen: lineTotal(l), vatBps: vatBps(s, l.vatKind) })));
}

/** Kann der Kunde noch zusagen? Gesendet und Gültigkeit nicht überschritten (letzter Gültigkeitstag zählt noch). */
export function offerOpen(o: { status: string; validUntil: string }, today: string): boolean {
  return o.status === "sent" && o.validUntil >= today;
}

export const OFFER_STATUS_LABEL: Record<string, string> = { draft: "Entwurf", sent: "Gesendet", accepted: "Angenommen", declined: "Abgelehnt", expired: "Abgelaufen" };

export const offerNumber = (seq: number, year: string) => `A-${year}-${String(seq).padStart(4, "0")}`;
