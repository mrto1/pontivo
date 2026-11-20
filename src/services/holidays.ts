import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { schoolHolidays, type Hotel } from "../db/schema";
import { addDays } from "../domain/dates";
import { parseSchoolHolidaysCsv, suggestions, type Suggestion } from "../domain/holidays";
import { audit } from "./audit";
import { PricingError, addEvent, listEvents } from "./pricing-rules";

/** Schulferien-Import der Plattform (Referenzdaten, kein Mandantenbezug): bestehende Einträge (Kanton, Name, Beginn) werden aktualisiert. */
export async function importSchoolHolidays(csv: string, actor: string): Promise<{ imported: number; errors: string[] }> {
  const { rows, errors } = parseSchoolHolidaysCsv(csv.slice(0, 200_000));
  if (!rows.length) return { imported: 0, errors: errors.length ? errors : ["Keine gültigen Zeilen gefunden."] };
  await db().transaction(async (tx) => {
    for (const r of rows) {
      await tx.insert(schoolHolidays).values(r).onConflictDoUpdate({ target: [schoolHolidays.canton, schoolHolidays.name, schoolHolidays.fromDay], set: { toDay: r.toDay } });
    }
    await audit(tx, { hotelId: null, actor, action: "platform.school_holidays_imported", entity: "school_holidays", details: { rows: rows.length, errors: errors.length } });
  });
  return { imported: rows.length, errors };
}

export async function schoolHolidayStats(today: string) {
  return db().select({ canton: schoolHolidays.canton, n: sql<number>`count(*)::int`, last: sql<string>`max(${schoolHolidays.toDay})` }).from(schoolHolidays)
    .where(gte(schoolHolidays.toDay, today)).groupBy(schoolHolidays.canton).orderBy(schoolHolidays.canton);
}

const HORIZON_DAYS = 400;

/** Vorschläge für den Kanton des Betriebs, ohne bereits eingetragene Ereignisse */
export async function holidaySuggestions(hotel: Pick<Hotel, "id" | "canton">, today: string): Promise<Suggestion[]> {
  const to = addDays(today, HORIZON_DAYS);
  const school = await db().select().from(schoolHolidays).where(and(eq(schoolHolidays.canton, hotel.canton), gte(schoolHolidays.toDay, today))).orderBy(asc(schoolHolidays.fromDay));
  const existing = await listEvents(hotel.id, today);
  return suggestions(hotel.canton, today, to, school, existing);
}

/** Gewählte Vorschläge als Preis-Ereignisse übernehmen. Schlüssel werden gegen die aktuellen Vorschläge geprüft (nichts Fremdes). */
export async function adoptSuggestions(hotel: Pick<Hotel, "id" | "canton">, today: string, keys: string[], pct: { feiertag: number; schulferien: number }, actor: string): Promise<number> {
  const valid = new Map((await holidaySuggestions(hotel, today)).map((s) => [s.key, s]));
  let n = 0;
  for (const k of new Set(keys)) {
    const s = valid.get(k);
    if (!s) continue;
    const p = pct[s.kind];
    if (!p) throw new PricingError(s.kind === "feiertag" ? "Zuschlag für Feiertage fehlt." : "Zuschlag für Schulferien fehlt.");
    await addEvent(hotel.id, { name: s.name, fromDay: s.fromDay, toDay: s.toDay, adjustBps: Math.round(p * 100) }, actor);
    n++;
  }
  return n;
}
