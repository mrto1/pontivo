/** Mehrzimmerbuchung (SPEC 19.6): Personen auf mehrere gleiche Zimmer verteilen, reine Logik */
export type RoomGuests = { adults: number; children: number; childrenAges: (number | null)[] };

export const MAX_ROOMS = 6;

/**
 * Erwachsene und Kinder möglichst gleichmässig auf `rooms` Zimmer verteilen (jedes Zimmer mindestens 1 Erwachsener).
 * Kinder (mit ihrem Alter) werden reihum verteilt. Gibt null zurück, wenn es zu wenige Erwachsene gibt.
 */
export function splitGuests(adults: number, children: number, ages: (number | null)[], rooms: number): RoomGuests[] | null {
  if (!Number.isInteger(rooms) || rooms < 1 || rooms > MAX_ROOMS || adults < rooms) return null;
  const out: RoomGuests[] = Array.from({ length: rooms }, (_, i) => ({ adults: Math.floor(adults / rooms) + (i < adults % rooms ? 1 : 0), children: 0, childrenAges: [] }));
  for (let c = 0; c < children; c++) {
    const r = out[c % rooms];
    r.children++;
    r.childrenAges.push(ages[c] ?? null);
  }
  return out;
}
