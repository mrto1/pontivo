/**
 * KI-Chat (SPEC 14b): Kontingent, Zusatzpakete und Abrechnung. Reine Logik ohne I/O.
 * Geld in Rappen, Monate als "YYYY-MM", Tage als "YYYY-MM-DD".
 */

export type AiTerms = {
  planCode: string;
  name: string;
  priceRappen: number;
  included: number;
  /** 0 = keine Zusatzpakete */
  packSize: number;
  packPriceRappen: number;
  acceptedAt: string;
  acceptedBy: string;
  /** Version der Bedingungen für Gastgeber, die bei der Bestätigung galt */
  termsVersion?: string;
};

export type AiModuleSettings = {
  terms?: AiTerms;
  /** Monatsbudget für Zusatzpakete in Rappen, 0 = aus (Pause bei Limit) */
  overageBudgetRappen?: number;
  /** erster Tag der aktuellen Laufzeit */
  enabledSince?: string;
  /** letzter Tag der Laufzeit (Kündigung wirkt zum Monatsende), null = läuft */
  endsAt?: string | null;
  /** Monat der ersten Aktivierung überhaupt: kostenlos, wird nie zurückgesetzt */
  freeMonth?: string;
};

/** Anzahl angebrochener Zusatzpakete für die Gespräche eines Monats */
export function packsUsed(conversations: number, included: number, packSize: number): number {
  if (packSize <= 0) return 0;
  return Math.ceil(Math.max(0, conversations - included) / packSize);
}

/** Wie viele Gespräche im Monat höchstens erlaubt sind (Kontingent + Zusatzpakete im Budget, begrenzt durch die technische Obergrenze) */
export function allowedConversations(t: Pick<AiTerms, "included" | "packSize" | "packPriceRappen">, budgetRappen: number, hardCap: number): number {
  const packs = t.packSize > 0 && t.packPriceRappen > 0 && budgetRappen > 0 ? Math.floor(budgetRappen / t.packPriceRappen) : 0;
  return Math.min(t.included + packs * t.packSize, hardCap);
}

export const SESSION_IDLE_MS = 30 * 60_000;
export const MAX_USER_MESSAGES = 20;

/** Gehört eine bestehende Sitzung noch zum selben Gespräch? */
export function sessionContinues(row: { messages: number; lastAt: Date }, now: Date): boolean {
  return row.messages < MAX_USER_MESSAGES && now.getTime() - row.lastAt.getTime() < SESSION_IDLE_MS;
}

const lastDayOfMonth = (m: string): string => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};

/** Letzter Tag des Monats, in dem heute liegt (Kündigung wirkt zum Monatsende) */
export function endOfMonthOf(day: string): string {
  return lastDayOfMonth(day.slice(0, 7));
}

/** Läuft das Modul an diesem Tag? (eingeschaltet, Beginn erreicht, Ende nicht überschritten) */
export function moduleActiveOn(enabled: boolean, s: AiModuleSettings, today: string): boolean {
  if (!enabled || !s.terms || !s.enabledSince) return false;
  if (s.enabledSince > today) return false;
  return !s.endsAt || s.endsAt >= today;
}

/** Wird der Modulpreis für diesen Monat erhoben? Aktivierungsmonat (erste Aktivierung) ist kostenlos, Monate ohne Laufzeit nicht. */
export function moduleBillable(month: string, s: AiModuleSettings): boolean {
  if (!s.terms || !s.enabledSince) return false;
  if (s.enabledSince > lastDayOfMonth(month)) return false;
  if (s.endsAt && s.endsAt < `${month}-01`) return false;
  return month !== s.freeMonth;
}

export type AiMonthBill = { moduleRappen: number; packsRappen: number; packs: number; conversations: number; totalRappen: number };

/** Abrechnung eines Monats aus den Konditionen und der Zahl der Gespräche */
export function aiBillForMonth(month: string, s: AiModuleSettings, conversations: number): AiMonthBill {
  const none: AiMonthBill = { moduleRappen: 0, packsRappen: 0, packs: 0, conversations, totalRappen: 0 };
  const t = s.terms;
  if (!t || !s.enabledSince) return none;
  const moduleRappen = moduleBillable(month, s) ? t.priceRappen : 0;
  // Zusatzpakete gibt es nur, wenn das Hotel sie freigegeben hat; mehr als das Budget wird nie berechnet (Pause)
  const budget = s.overageBudgetRappen ?? 0;
  const used = packsUsed(conversations, t.included, t.packSize);
  const maxPacks = t.packPriceRappen > 0 ? Math.floor(budget / t.packPriceRappen) : 0;
  const packs = Math.min(used, maxPacks);
  const packsRappen = packs * t.packPriceRappen;
  return { moduleRappen, packsRappen, packs, conversations, totalRappen: moduleRappen + packsRappen };
}
