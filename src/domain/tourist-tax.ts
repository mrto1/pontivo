import { UserError } from "./errors";
/** Kurtaxe (SPEC 5.2). Reine Logik, die passende Regel liefert der Aufrufer. */

export type TaxRule = {
  adultRappen: number | null;
  reducedRappen: number | null;
  freeUnderAge: number;
  reducedUnderAge: number | null;
  status: string; // 'verified' | 'needs_confirmation' | 'none'
};

export class TouristTaxUnconfirmedError extends UserError {
  constructor() {
    super("Kurtaxe-Satz für diese Gemeinde ist nicht bestätigt");
  }
}

/** Ob die Regel Altersgrenzen hat und darum das Alter der Kinder Pflicht ist */
export function needsChildAges(rule: TaxRule | null): boolean {
  if (!rule || rule.status === "none" || !rule.adultRappen) return false;
  return rule.freeUnderAge > 0 || rule.reducedUnderAge !== null;
}

/** Satz pro Person und Nacht; age = null bei Erwachsenen ohne Angabe bzw. Kindern ohne Angabe */
export function ratePerPerson(rule: TaxRule, age: number | null, isChild: boolean): number {
  const adult = rule.adultRappen ?? 0;
  if (age === null) {
    return isChild ? (rule.reducedRappen ?? adult) : adult;
  }
  if (age < rule.freeUnderAge) return 0;
  if (rule.reducedUnderAge !== null && rule.reducedRappen !== null && age < rule.reducedUnderAge) {
    return rule.reducedRappen;
  }
  return adult;
}

export function computeTouristTax(
  rule: TaxRule | null,
  input: { adults: number; childrenAges: (number | null)[]; nights: number },
): number {
  if (rule && (rule.status === "none" || rule.adultRappen === 0)) return 0;
  if (!rule || rule.adultRappen === null || rule.status === "needs_confirmation") {
    throw new TouristTaxUnconfirmedError();
  }
  let perNight = 0;
  for (let i = 0; i < input.adults; i++) perNight += ratePerPerson(rule, null, false);
  for (const age of input.childrenAges) perNight += ratePerPerson(rule, age, true);
  return perNight * input.nights;
}

/** Regelwahl: jüngste Regel mit valid_from <= checkin */
export function pickRule<T extends { validFrom: string }>(rules: T[], checkin: string): T | null {
  const valid = rules.filter((r) => r.validFrom <= checkin).sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  return valid[0] ?? null;
}
