/**
 * Kennzahlen (SPEC 17.3): reine Logik. Beträge in Rappen, Preise der Nächte ohne Kurtaxe.
 * Belegung = verkaufte Zimmernächte / verfügbare Zimmernächte; ADR = Zimmerumsatz / verkaufte Zimmernächte;
 * RevPAR = Zimmerumsatz / verfügbare Zimmernächte.
 */
export type NightRow = { night: string; roomTypeId: string; source: string; priceRappen: number };
export type TypeCap = { id: string; name: string; count: number };

export type Kpi = { available: number; sold: number; revenueRappen: number; occupancyPct: number; adrRappen: number; revparRappen: number };

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const div = (a: number, b: number) => (b > 0 ? a / b : 0);

export function kpi(sold: number, revenueRappen: number, available: number): Kpi {
  return { available, sold, revenueRappen, occupancyPct: Math.round(div(sold * 1000, available)) / 10, adrRappen: Math.round(div(revenueRappen, sold)), revparRappen: Math.round(div(revenueRappen, available)) };
}

export type StatsResult = {
  total: Kpi;
  byMonth: ({ month: string } & Kpi)[];
  bySource: { source: string; sold: number; revenueRappen: number; sharePct: number }[];
  byType: ({ id: string; name: string } & Kpi)[];
};

/** `from` inklusive, `to` exklusiv (YYYY-MM-DD). Nächte ausserhalb des Zeitraums werden ignoriert. */
export function computeStats(rows: NightRow[], types: TypeCap[], from: string, to: string): StatsResult {
  const inRange = rows.filter((r) => r.night >= from && r.night < to);
  const nights = Math.max(0, daysBetween(from, to));
  const totalCount = types.reduce((a, t) => a + t.count, 0);
  const sum = (rs: NightRow[]) => rs.reduce((a, r) => a + r.priceRappen, 0);

  const total = kpi(inRange.length, sum(inRange), totalCount * nights);

  const months = new Map<string, number>(); // Monat → Anzahl Tage im Zeitraum
  for (let i = 0; i < nights; i++) {
    const m = new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 7);
    months.set(m, (months.get(m) ?? 0) + 1);
  }
  const byMonth = [...months].map(([month, days]) => {
    const rs = inRange.filter((r) => r.night.startsWith(month));
    return { month, ...kpi(rs.length, sum(rs), totalCount * days) };
  });

  const src = new Map<string, { sold: number; revenueRappen: number }>();
  for (const r of inRange) {
    const c = src.get(r.source) ?? { sold: 0, revenueRappen: 0 };
    c.sold++; c.revenueRappen += r.priceRappen; src.set(r.source, c);
  }
  const bySource = [...src].map(([source, c]) => ({ source, ...c, sharePct: Math.round(div(c.sold * 1000, inRange.length)) / 10 })).sort((a, b) => b.sold - a.sold);

  const byType = types.map((t) => {
    const rs = inRange.filter((r) => r.roomTypeId === t.id);
    return { id: t.id, name: t.name, ...kpi(rs.length, sum(rs), t.count * nights) };
  });
  return { total, byMonth, bySource, byType };
}
