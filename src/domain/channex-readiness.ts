import { addDays, diffDays, type Day } from "./dates";

/** Preis-Abdeckung eines Tarifs ab heute (reine Logik, SPEC 7.1: Hinweis vor dem Verbinden). */
export type PlanCoverage = { name: string; pricedDays: number; lastNight: Day | null };

// ASSUMPTION: Preise sollten mindestens 90 Tage im Voraus gepflegt sein, bevor ein Kanal angebunden wird.
export const MIN_PRICED_DAYS_AHEAD = 90;

/** Gibt einen Hinweistext zurück, wenn die Preise eines Tarifs für die Anbindung nicht ausreichen. */
export function coverageIssue(c: PlanCoverage, today: Day, minDaysAhead = MIN_PRICED_DAYS_AHEAD): string | null {
  if (c.pricedDays === 0 || !c.lastNight) return `${c.name}: keine Preise ab heute hinterlegt`;
  if (diffDays(today, c.lastNight) < minDaysAhead) {
    return `${c.name}: Preise nur bis ${c.lastNight.split("-").reverse().join(".")} (empfohlen: mindestens bis ${addDays(today, minDaysAhead).split("-").reverse().join(".")})`;
  }
  return null;
}
