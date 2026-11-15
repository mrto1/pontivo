/** Eigentümerabrechnung (SPEC 19.10). Reine Logik, Beträge in Rappen. */
export type StatementNight = { night: string; priceRappen: number };

/** Umsatz der Nächte, die in den Monat (JJJJ-MM) fallen */
export function monthRevenue(nights: StatementNight[], month: string): number {
  return nights.filter((n) => n.night.startsWith(`${month}-`)).reduce((a, n) => a + n.priceRappen, 0);
}

/** Kommission auf ganze Rappen gerundet (kaufmännisch) */
export const commissionOf = (revenueRappen: number, bps: number) => Math.round((revenueRappen * bps) / 10000);

export type Statement = { revenueRappen: number; commissionRappen: number; costsRappen: number; netRappen: number };

/** Auszahlung = Umsatz − Kommission − Kosten (kann negativ sein: Eigentümer schuldet dem Haus) */
export function statement(revenueRappen: number, bps: number, costsRappen: number): Statement {
  const commissionRappen = commissionOf(revenueRappen, bps);
  return { revenueRappen, commissionRappen, costsRappen, netRappen: revenueRappen - commissionRappen - costsRappen };
}

export const validMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/** Zimmertypen, die schon einem anderen aktiven Eigentümer gehören */
export function overlap(mine: string[], others: string[][]): string[] {
  const taken = new Set(others.flat());
  return mine.filter((id) => taken.has(id));
}
