import type { Day } from "./dates";
import { platformFee } from "./pricing";
import type { OrderFeeModel } from "./platform-invoice";

/**
 * Preis der Online-Bestellung (SPEC 20.4, Entscheid 21.11.2026):
 * - Normalpreis: Plattformgebühr (1,9 %) pro Bestellung.
 * - Sonderangebot: die ersten 3 Monate ab dem ersten Einschalten pauschal CHF 59 pro Monat, keine Gebühr pro Bestellung.
 *   Angefangener Startmonat zählt nicht mit (Start am 10. Januar → pauschal bis Ende April).
 * - Pilotbetriebe (die ersten 10, die einschalten): 12 Monate ab Start höchstens CHF 149 Gebühren pro Kalendermonat.
 * - Solange das Plattform-Preismodell «fixed» ist (ESTV-Anfrage offen), zahlen alle die Pauschale, unabhängig vom Startdatum.
 */
export const ORDER_INTRO_MONTHS = 3;
export const PILOT_SLOTS = 10;
export const PILOT_MONTHS = 12;
export const PILOT_CAP_RAPPEN = 14_900;

/** Monate addieren; Monatsende bleibt im Zielmonat (31.01. + 1 → 28./29.02.) */
export function addMonths(day: Day, n: number): Day {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

/** Erster Tag nach dem Sonderangebot */
export function introUntil(startedOn: Day): Day {
  const first = `${startedOn.slice(0, 8)}01`;
  return addMonths(first, ORDER_INTRO_MONTHS + (startedOn === first ? 0 : 1));
}

/** Erster Tag nach dem Pilot-Kostendach */
export const pilotUntilFor = (startedOn: Day): Day => addMonths(startedOn, PILOT_MONTHS);

export type OrderFeeState = { model: OrderFeeModel; startedOn: Day | null; pilotUntil: Day | null };

/** Im Sonderangebot (pauschal)? Ohne Startdatum: nein (Bestellungen nur nach dem Einschalten) */
export function inIntro(s: OrderFeeState, day: Day): boolean {
  if (s.model === "fixed") return true;
  return !!s.startedOn && day < introUntil(s.startedOn);
}

/** Pauschale für einen Monat ('YYYY-MM') fällig (sofern eingeschaltet oder mit Bestellungen)? */
export function flatForMonth(s: OrderFeeState, month: string): boolean {
  if (s.model === "fixed") return true;
  return !!s.startedOn && `${month}-01` < introUntil(s.startedOn);
}

/** Gebühr einer Bestellung; feesThisMonth = bisherige Gebühren im selben Kalendermonat (für das Kostendach) */
export function orderFee(s: OrderFeeState, day: Day, totalRappen: number, feeBps: number, feesThisMonthRappen: number): number {
  if (inIntro(s, day)) return 0;
  const fee = platformFee(totalRappen, feeBps);
  if (s.pilotUntil && day < s.pilotUntil) return Math.max(0, Math.min(fee, PILOT_CAP_RAPPEN - feesThisMonthRappen));
  return fee;
}

const dmy = (d: Day) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const chf = (r: number) => `CHF ${r % 100 ? (r / 100).toFixed(2) : String(r / 100)}`;

/** Preisangabe für den Betrieb (Einstellungen der Online-Bestellung) */
export function orderPriceText(s: OrderFeeState, today: Day, feePercent: string, flatRappen: number, pilotSlotsLeft: number): string {
  const normal = `${feePercent} % pro Bestellung (auch bar, dann mit der Monatsrechnung)`;
  const pilot = s.pilotUntil && today < s.pilotUntil ? ` Als Pilotbetrieb zahlen Sie bis ${dmy(addDaysLocal(s.pilotUntil, -1))} nie mehr als ${chf(PILOT_CAP_RAPPEN)} pro Monat.` : "";
  if (!s.startedOn) {
    const offer = pilotSlotsLeft > 0 ? ` Als einer der ersten ${PILOT_SLOTS} Betriebe werden Sie Pilotbetrieb: ${PILOT_MONTHS} Monate lang höchstens ${chf(PILOT_CAP_RAPPEN)} pro Monat (noch ${pilotSlotsLeft} Plätze frei).` : "";
    return `Normalpreis ${normal}. Sonderangebot: die ersten ${ORDER_INTRO_MONTHS} Monate ab dem Einschalten pauschal ${chf(flatRappen)} pro Monat, keine Gebühr pro Bestellung.${offer}`;
  }
  if (inIntro(s, today)) {
    const end = dmy(addDaysLocal(introUntil(s.startedOn), -1));
    return `Sonderangebot ${s.model === "fixed" ? "mindestens " : ""}bis ${end}: pauschal ${chf(flatRappen)} pro Monat, keine Gebühr pro Bestellung. Danach ${normal}; den Wechsel kündigen wir vorher an.${pilot}`;
  }
  return `${normal}.${pilot}`;
}

function addDaysLocal(day: Day, n: number): Day {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
