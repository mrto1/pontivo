/** Monatsmail an die Inhaber (SPEC 19.32), reine Logik */
// ASSUMPTION: Übliche Portalprovision 15 % als Vergleichswert («Ersparnis»); nur eine grobe Schätzung und so beschriftet.
export const PORTAL_COMMISSION_BPS = 1500;

export type MonthStats = { bookings: number; nights: number; /** Zimmerumsatz ohne Kurtaxe, nach Rückerstattung */ revenueRappen: number; feeRappen: number };

export type MonthlySummary = {
  month: string;
  cur: MonthStats;
  prev: MonthStats;
  /** geschätzte Ersparnis gegenüber Portalprovision abzüglich der Plattformgebühr, 0 wenn nicht positiv */
  savedRappen: number;
  /** bestätigte Anreisen in den nächsten 30 Tagen */
  upcomingArrivals: number;
};

export function summarize(month: string, cur: MonthStats, prev: MonthStats, upcomingArrivals: number): MonthlySummary {
  const saved = Math.round((cur.revenueRappen * PORTAL_COMMISSION_BPS) / 10_000) - cur.feeRappen;
  return { month, cur, prev, savedRappen: Math.max(0, saved), upcomingArrivals };
}

/** Lohnt sich eine Mail? Nichts zu berichten, wenn in beiden Monaten keine Direktbuchung */
export const worthSending = (s: MonthlySummary) => s.cur.bookings > 0 || s.prev.bookings > 0;

/** Veränderung in Prozent gegenüber dem Vormonat, null ohne Vergleichswert */
export const changePct = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const monthLabelDe = (month: string) => `${MONTHS_DE[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
