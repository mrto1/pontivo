import { addDays, isDay } from "./dates";

/**
 * Feiertage und Schulferien als Vorschläge für Preis-Ereignisse (SPEC 19.33). Reine Logik ohne I/O.
 * Feiertage werden berechnet (Ostern nach Gauss), Schulferien kommen aus importierten Daten, nie aus dem Code.
 */
export const CANTONS = ["AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE", "NW", "OW", "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH"] as const;

/** Ostersonntag (Gregorianisch, anonymer Algorithmus) */
export function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ASSUMPTION: Feiertagsregeln je Kanton sind vereinfacht (kantonal geregelt, teils nur in einzelnen Gemeinden). Es sind Vorschläge,
// der Betrieb wählt aus. Katholische Feiertage nur in den Kantonen, in denen sie ganz oder überwiegend gelten.
const CATHOLIC = ["AG", "AI", "FR", "JU", "LU", "NW", "OW", "SZ", "TI", "UR", "VS", "ZG"];
const NO_GOOD_FRIDAY = ["TI", "VS"];
const NO_STEPHAN = ["GE", "NE", "VD"];
const THREE_KINGS = ["SZ", "TI", "UR"];
const IMMACULATE = ["AI", "FR", "LU", "NW", "OW", "SZ", "TI", "UR", "VS", "ZG"];

export type Holiday = { name: string; day: string };

export function holidaysFor(year: number, canton: string): Holiday[] {
  const c = canton.toUpperCase();
  const easter = easterSunday(year);
  const out: Holiday[] = [
    { name: "Neujahr", day: `${year}-01-01` },
    { name: "Ostermontag", day: addDays(easter, 1) },
    { name: "Auffahrt", day: addDays(easter, 39) },
    { name: "Pfingstmontag", day: addDays(easter, 50) },
    { name: "Nationalfeiertag", day: `${year}-08-01` },
    { name: "Weihnachten", day: `${year}-12-25` },
  ];
  if (!NO_GOOD_FRIDAY.includes(c)) out.push({ name: "Karfreitag", day: addDays(easter, -2) });
  if (!NO_STEPHAN.includes(c)) out.push({ name: "Stephanstag", day: `${year}-12-26` });
  if (THREE_KINGS.includes(c)) out.push({ name: "Heilige Drei Könige", day: `${year}-01-06` });
  if (CATHOLIC.includes(c)) {
    out.push({ name: "Fronleichnam", day: addDays(easter, 60) });
    out.push({ name: "Mariä Himmelfahrt", day: `${year}-08-15` });
    out.push({ name: "Allerheiligen", day: `${year}-11-01` });
  }
  if (IMMACULATE.includes(c)) out.push({ name: "Mariä Empfängnis", day: `${year}-12-08` });
  return out.sort((x, y) => x.day.localeCompare(y.day));
}

export type SchoolRow = { canton: string; name: string; fromDay: string; toDay: string };

/** CSV-Import: je Zeile `Kanton;Name;von;bis` (Trennzeichen ; , oder Tab, Daten JJJJ-MM-TT oder TT.MM.JJJJ). Erste Zeile darf Kopfzeile sein. */
export function parseSchoolHolidaysCsv(text: string): { rows: SchoolRow[]; errors: string[] } {
  const rows: SchoolRow[] = [], errors: string[] = [];
  const toDay = (v: string) => {
    const t = v.trim();
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
    const d = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : t;
    return isDay(d) ? d : null;
  };
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const p = line.split(/[;\t,]/).map((x) => x.trim());
    if (i === 0 && !toDay(p[2] ?? "")) return; // Kopfzeile
    const canton = (p[0] ?? "").toUpperCase();
    const name = (p[1] ?? "").slice(0, 80);
    const from = toDay(p[2] ?? ""), to = toDay(p[3] ?? "");
    if (!(CANTONS as readonly string[]).includes(canton)) return void errors.push(`Zeile ${i + 1}: Kanton «${p[0] ?? ""}» unbekannt`);
    if (!name) return void errors.push(`Zeile ${i + 1}: Name fehlt`);
    if (!from || !to) return void errors.push(`Zeile ${i + 1}: Datum ungültig`);
    if (to < from) return void errors.push(`Zeile ${i + 1}: «bis» liegt vor «von»`);
    rows.push({ canton, name, fromDay: from, toDay: to });
  });
  return { rows, errors };
}

export type Suggestion = { key: string; kind: "feiertag" | "schulferien"; name: string; fromDay: string; toDay: string };

/** Vorschläge im Zeitraum [fromDay, toDay], ohne bereits vorhandene Ereignisse (gleicher Name und gleicher Beginn) */
export function suggestions(canton: string, fromDay: string, toDay: string, school: SchoolRow[], existing: { name: string; fromDay: string }[]): Suggestion[] {
  const have = new Set(existing.map((e) => `${e.name}|${e.fromDay}`));
  const out: Suggestion[] = [];
  const y0 = Number(fromDay.slice(0, 4)), y1 = Number(toDay.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    for (const h of holidaysFor(y, canton)) if (h.day >= fromDay && h.day <= toDay) out.push({ key: `feiertag|${h.name}|${h.day}|${h.day}`, kind: "feiertag", name: h.name, fromDay: h.day, toDay: h.day });
  }
  for (const s of school) {
    if (s.canton.toUpperCase() !== canton.toUpperCase() || s.toDay < fromDay || s.fromDay > toDay) continue;
    out.push({ key: `schulferien|${s.name}|${s.fromDay}|${s.toDay}`, kind: "schulferien", name: `${s.name} (${s.canton.toUpperCase()})`, fromDay: s.fromDay, toDay: s.toDay });
  }
  return out.filter((s) => !have.has(`${s.name}|${s.fromDay}`)).sort((a, b) => a.fromDay.localeCompare(b.fromDay) || a.name.localeCompare(b.name));
}
