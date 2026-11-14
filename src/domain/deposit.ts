import { addDays, diffDays, type Day } from "./dates";
import { bpsOf } from "./money";

/** Anzahlung (SPEC 5.9). Reine Rechnung ohne I/O. */

export const MIN_BALANCE_RAPPEN = 1000; // Rest unter CHF 10: lieber gleich voll bezahlen

export type DepositPlan = { kind: "full" } | { kind: "deposit"; depositRappen: number; balanceRappen: number; balanceDueOn: Day };

/**
 * `cardRappen` = Betrag, der per Karte/TWINT zu zahlen ist (Total minus Gutschein).
 * Anzahlung nur, wenn das Hotel sie eingeschaltet hat, die Anreise weiter weg liegt als die Fälligkeit des Rests
 * und der Rest nicht winzig ist. Sonst volle Zahlung.
 */
export function planPayment(h: { depositBps: number; balanceDueDays: number }, cardRappen: number, checkin: Day, today: Day): DepositPlan {
  if (h.depositBps >= 10000 || cardRappen <= 0) return { kind: "full" };
  if (diffDays(today, checkin) <= h.balanceDueDays) return { kind: "full" };
  const deposit = bpsOf(cardRappen, h.depositBps);
  const balance = cardRappen - deposit;
  if (deposit < 1 || balance < MIN_BALANCE_RAPPEN) return { kind: "full" };
  return { kind: "deposit", depositRappen: deposit, balanceRappen: balance, balanceDueOn: addDays(checkin, -h.balanceDueDays) };
}

/** Plattformgebühr anteilig auf einen Teilbetrag; Anzahlung + Rest ergeben genau die Gesamtgebühr */
export function feeShare(totalFee: number, cardTotal: number, part: number): number {
  if (cardTotal <= 0) return 0;
  return Math.round((totalFee * part) / cardTotal);
}
