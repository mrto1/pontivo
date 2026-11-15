/** Pauschalen (SPEC 19.4): Verpflegungsart und MWST-Aufteilung, reine Logik */
export type Board = "none" | "breakfast" | "half" | "full";

const LABELS: Record<Board, string> = { none: "nur Übernachtung", breakfast: "mit Frühstück", half: "Halbpension", full: "Vollpension" };
export const boardLabel = (b: Board) => LABELS[b] ?? LABELS.none;

/**
 * Bei Halb-/Vollpension steckt Restauration (Normalsatz) im Pauschalpreis. Anteil = Wert je Person und Nacht × Personen × Nächte,
 * höchstens der Zimmerbetrag. Der Rest bleibt Beherbergung (inkl. Frühstück, Sondersatz). Die Summe bleibt unverändert.
 */
export function splitBoard(amountRappen: number, board: Board, persons: number, nights: number, mealRappen: number): { stayRappen: number; mealsRappen: number } {
  if ((board !== "half" && board !== "full") || mealRappen <= 0 || amountRappen <= 0) return { stayRappen: amountRappen, mealsRappen: 0 };
  const meals = Math.min(amountRappen, mealRappen * Math.max(1, persons) * Math.max(1, nights));
  return { stayRappen: amountRappen - meals, mealsRappen: meals };
}
