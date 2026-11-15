import crypto from "node:crypto";
import { addDays } from "./dates";
import { vatBreakdown, type VatRow } from "./invoice";

/**
 * Restaurant und Kasse (SPEC 19.16): reine Logik. Preise sind Bruttopreise (inkl. MWST), Beträge in Rappen.
 * Bons sind unveränderbar (Art. 958f Abs. 4 OR) und in einer Hash-Kette verbunden (Änderungen erkennbar, Art. 3 GeBüV).
 */
export const GENESIS_HASH = "0".repeat(64);
export const METHODS = ["cash", "card", "twint", "room"] as const;
export type Method = (typeof METHODS)[number];
export const METHOD_LABEL: Record<Method, string> = { cash: "Bar", card: "Karte", twint: "TWINT", room: "Aufs Zimmer" };

export const receiptNumber = (deviceCode: string, bonNo: number) => `${deviceCode}-${String(bonNo).padStart(6, "0")}`;

// ---------------------------------------------------------------- Bestellzeilen und Offenes

export type Line = { id: string; quantity: number; unitPriceRappen: number; vatBps: number; reversesLineId: string | null };
export type PaidItem = { lineId: string; quantity: number };

/** Wirksame Menge einer Zeile: eigene Menge plus Stornozeilen (negativ), die sie aufheben. Stornozeilen selbst zählen nicht. */
export function effectiveQuantities(lines: Line[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) if (!l.reversesLineId) m.set(l.id, (m.get(l.id) ?? 0) + l.quantity);
  for (const l of lines) if (l.reversesLineId && m.has(l.reversesLineId)) m.set(l.reversesLineId, m.get(l.reversesLineId)! + l.quantity);
  return m;
}

/** Noch nicht bezahlte Menge je Zeile: wirksame Menge minus bezahlte (Verkauf positiv, Gegenbon negativ) */
export function outstanding(lines: Line[], paid: PaidItem[]): Map<string, number> {
  const eff = effectiveQuantities(lines);
  const out = new Map<string, number>();
  for (const [id, q] of eff) out.set(id, q);
  for (const p of paid) if (out.has(p.lineId)) out.set(p.lineId, out.get(p.lineId)! - p.quantity);
  return out;
}

export function openTotalRappen(lines: Line[], paid: PaidItem[]): number {
  const o = outstanding(lines, paid);
  return lines.filter((l) => !l.reversesLineId).reduce((a, l) => a + (o.get(l.id) ?? 0) * l.unitPriceRappen, 0);
}

export type Selection = { lineId: string; quantity: number };

/** Auswahl zum Bezahlen prüfen (Splitten nach Posten oder Gast): jede Menge > 0 und höchstens das Offene; Rabattzeilen (negativ) dürfen ganz mit */
export function checkSelection(lines: Line[], paid: PaidItem[], sel: Selection[]): string | null {
  if (!sel.length) return "Nichts ausgewählt.";
  const o = outstanding(lines, paid);
  const seen = new Set<string>();
  for (const s of sel) {
    if (seen.has(s.lineId)) return "Eine Zeile ist doppelt ausgewählt.";
    seen.add(s.lineId);
    const open = o.get(s.lineId);
    if (open === undefined) return "Unbekannte Zeile.";
    if (!Number.isInteger(s.quantity) || s.quantity === 0) return "Ungültige Menge.";
    if (open > 0 ? s.quantity < 1 || s.quantity > open : s.quantity > -1 || s.quantity < open) return "Es ist weniger offen als ausgewählt.";
  }
  return null;
}

export function selectionTotal(lines: Line[], sel: Selection[]): { totalRappen: number; vat: VatRow[]; vatRappen: number } {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const vl = sel.map((s) => { const l = byId.get(s.lineId)!; return { amountRappen: s.quantity * l.unitPriceRappen, vatBps: l.vatBps }; });
  const b = vatBreakdown(vl);
  return { totalRappen: b.totalRappen, vat: b.rows, vatRappen: b.vatRappen };
}

// ---------------------------------------------------------------- Hash-Kette

export type ChainRecord = {
  hotelId: string; number: string; seq: number; kind: string; reversesReceiptId: string | null;
  items: unknown; totalRappen: number; vat: unknown; tipRappen: number; businessDay: string; cashier: string; paidAt: string;
};

/** Festes Feldreihenfolge-Format, damit derselbe Bon immer denselben Hash ergibt */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  return v;
}
/** Schlüssel sortiert, weil jsonb in Postgres die Reihenfolge ändert */
export function canonical(r: ChainRecord): string {
  return JSON.stringify(stable([r.hotelId, r.number, r.seq, r.kind, r.reversesReceiptId, r.items, r.totalRappen, r.vat, r.tipRappen, r.businessDay, r.cashier, r.paidAt]));
}
export const hashReceipt = (prevHash: string, r: ChainRecord) => crypto.createHash("sha256").update(prevHash).update("|").update(canonical(r)).digest("hex");

/** Kette prüfen: gibt die Nummer (seq) des ersten fehlerhaften Bons zurück, sonst null */
export function verifyChain(rs: (ChainRecord & { prevHash: string; hash: string })[]): number | null {
  let prev = GENESIS_HASH;
  const sorted = [...rs].sort((a, b) => a.seq - b.seq);
  for (const r of sorted) {
    if (r.prevHash !== prev || hashReceipt(prev, r) !== r.hash) return r.seq;
    prev = r.hash;
  }
  return null;
}

// ---------------------------------------------------------------- Geschäftstag und Z-Bericht

/**
 * Geschäftstag eines Bons: Tag der Zahlung (Hotelzeit). Ist dieser Tag schon abgeschlossen (Bon kam verspätet vom Gerät oder wurde nach
 * dem Z-Bericht kassiert), gilt der erste noch offene Tag ab heute, und der Bon ist als «verspätet» markiert.
 */
export function businessDay(paidDay: string, today: string, isClosed: (day: string) => boolean): { day: string; late: boolean } {
  if (!isClosed(paidDay)) return { day: paidDay, late: false };
  let d = today > paidDay ? today : paidDay;
  for (let i = 0; i < 400 && isClosed(d); i++) d = addDays(d, 1);
  return { day: d, late: true };
}

export type ReportReceipt = { kind: "sale" | "reversal"; totalRappen: number; tipRappen: number; late: boolean; vat: VatRow[]; payments: { method: Method; amountRappen: number }[] };
export type DayReport = {
  receipts: number; reversals: number; late: number;
  byMethod: Record<Method, number>; tipsByMethod: Record<Method, number>;
  vat: VatRow[]; totalRappen: number; expectedCashRappen: number;
};

/** Z-Bericht eines Tages. Gegenbons haben negative Beträge und mindern Summen. Erwartetes Bargeld = Barzahlungen plus Bar-Trinkgeld. */
export function dayReport(rs: ReportReceipt[]): DayReport {
  const zero = () => ({ cash: 0, card: 0, twint: 0, room: 0 }) as Record<Method, number>;
  const byMethod = zero(), tipsByMethod = zero();
  const vat = new Map<number, VatRow>();
  for (const r of rs) {
    for (const p of r.payments) byMethod[p.method] += p.amountRappen;
    // Trinkgeld gehört zur Zahlungsart des Bons; bei mehreren Zahlungsarten zur ersten
    if (r.tipRappen && r.payments[0]) tipsByMethod[r.payments[0].method] += r.tipRappen;
    for (const v of r.vat) {
      const x = vat.get(v.bps) ?? { bps: v.bps, grossRappen: 0, vatRappen: 0, netRappen: 0 };
      x.grossRappen += v.grossRappen; x.vatRappen += v.vatRappen; x.netRappen += v.netRappen;
      vat.set(v.bps, x);
    }
  }
  return {
    receipts: rs.filter((r) => r.kind === "sale").length, reversals: rs.filter((r) => r.kind === "reversal").length, late: rs.filter((r) => r.late).length,
    byMethod, tipsByMethod, vat: [...vat.values()].sort((a, b) => a.bps - b.bps),
    totalRappen: rs.reduce((a, r) => a + r.totalRappen, 0), expectedCashRappen: byMethod.cash + tipsByMethod.cash,
  };
}

/** Lücken im Nummernkreis eines Geräts (fehlende Bon-Nummern zwischen 1 und der höchsten) */
export function bonGaps(bonNos: number[]): number[] {
  if (!bonNos.length) return [];
  const have = new Set(bonNos);
  const max = Math.max(...bonNos);
  const gaps: number[] = [];
  for (let n = 1; n <= max; n++) if (!have.has(n)) gaps.push(n);
  return gaps;
}
