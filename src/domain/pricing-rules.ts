/**
 * Regelbasierte Preisempfehlung (SPEC 19.3), reine Logik ohne I/O.
 * Preis = Basispreis × (1 + Summe der Zu-/Abschläge), auf ganze Franken gerundet und
 * auf [Minimum, Maximum] begrenzt. Weil immer vom Basispreis ausgegangen wird, ist das Ergebnis
 * wiederholbar (kein Aufschaukeln bei mehrmaligem Berechnen).
 */
export type Rule = {
  baseRappen: number;
  minRappen: number;
  maxRappen: number;
  occupancySteps: { fromPct: number; bps: number }[];
  lastMinute: { withinDays: number; belowPct: number; bps: number } | null;
  weekdayBps: number[];
};
export type Ctx = { occupancyPct: number; leadDays: number; weekday: number; events: { name: string; bps: number }[] };
export type Result = { priceRappen: number; bps: number; reason: string; clamped: "min" | "max" | null };

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const pct = (bps: number) => `${bps > 0 ? "+" : ""}${Math.round(bps) / 100} %`;

export function validateRule(r: Rule): string | null {
  const ok = Number.isSafeInteger;
  if (!ok(r.baseRappen) || r.baseRappen <= 0) return "Basispreis muss grösser als 0 sein.";
  if (!ok(r.minRappen) || r.minRappen <= 0) return "Mindestpreis muss grösser als 0 sein.";
  if (!ok(r.maxRappen) || r.maxRappen < r.minRappen) return "Höchstpreis darf nicht unter dem Mindestpreis liegen.";
  if (r.weekdayBps.length !== 7 || r.weekdayBps.some((b) => !ok(b) || Math.abs(b) > 10000)) return "Wochentag-Zuschläge: 7 Werte zwischen -100 % und +100 %.";
  for (const s of r.occupancySteps) {
    if (!ok(s.fromPct) || s.fromPct < 0 || s.fromPct > 100 || !ok(s.bps) || Math.abs(s.bps) > 10000) return "Auslastungsstufe ungültig (0 bis 100 %, Zuschlag höchstens ±100 %).";
  }
  const lm = r.lastMinute;
  if (lm && (!ok(lm.withinDays) || lm.withinDays < 0 || !ok(lm.belowPct) || lm.belowPct < 0 || lm.belowPct > 100 || !ok(lm.bps) || Math.abs(lm.bps) > 10000)) return "Last-Minute-Regel ungültig.";
  return null;
}

export function proposePrice(rule: Rule, ctx: Ctx): Result {
  let bps = 0;
  const parts: string[] = [];
  const step = [...rule.occupancySteps].sort((a, b) => b.fromPct - a.fromPct).find((s) => ctx.occupancyPct >= s.fromPct);
  if (step && step.bps) { bps += step.bps; parts.push(`Auslastung ${Math.round(ctx.occupancyPct)} % (${pct(step.bps)})`); }
  const lm = rule.lastMinute;
  if (lm && lm.bps && ctx.leadDays <= lm.withinDays && ctx.occupancyPct < lm.belowPct) {
    bps += lm.bps;
    parts.push(`Last Minute, noch ${Math.max(0, ctx.leadDays)} Tage bei Auslastung unter ${lm.belowPct} % (${pct(lm.bps)})`);
  }
  const w = rule.weekdayBps[ctx.weekday] ?? 0;
  if (w) { bps += w; parts.push(`${WEEKDAYS[ctx.weekday]} (${pct(w)})`); }
  for (const e of ctx.events) if (e.bps) { bps += e.bps; parts.push(`${e.name} (${pct(e.bps)})`); }
  let price = Math.round((rule.baseRappen * (10000 + bps)) / 10000 / 100) * 100;
  let clamped: Result["clamped"] = null;
  if (price < rule.minRappen) { price = rule.minRappen; clamped = "min"; }
  if (price > rule.maxRappen) { price = rule.maxRappen; clamped = "max"; }
  let reason = parts.length ? parts.join(", ") : "Keine Regel trifft zu, Basispreis";
  if (clamped) reason += clamped === "min" ? ", auf Mindestpreis angehoben" : ", auf Höchstpreis begrenzt";
  return { priceRappen: price, bps, reason, clamped };
}
