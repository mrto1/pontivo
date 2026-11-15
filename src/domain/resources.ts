/** Buchbare Ressourcen (SPEC 19.11). Reine Logik; Zeiten in Minuten ab Mitternacht. */
export type ResourceDef = { capacity: number; slotMinutes: number; openFrom: number; openTo: number; priceRappen: number; pricePerPerson: boolean };
export type Slot = { startMin: number; endMin: number };
export type Taken = { startMin: number; endMin: number; persons: number };

export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function parseHhmm(t: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Alle Zeitfenster eines Tages (ab Öffnung im Raster der Fensterlänge, das letzte muss vor Schluss enden) */
export function slotsOf(r: Pick<ResourceDef, "slotMinutes" | "openFrom" | "openTo">): Slot[] {
  const out: Slot[] = [];
  for (let s = r.openFrom; s + r.slotMinutes <= r.openTo; s += r.slotMinutes) out.push({ startMin: s, endMin: s + r.slotMinutes });
  return out;
}

/** Gültiger Wunschzeitraum: auf dem Raster, innerhalb der Öffnungszeit, mindestens ein Fenster */
export function validRange(r: ResourceDef, startMin: number, endMin: number): boolean {
  if (startMin < r.openFrom || endMin > r.openTo || endMin <= startMin) return false;
  if ((startMin - r.openFrom) % r.slotMinutes !== 0) return false;
  return (endMin - startMin) % r.slotMinutes === 0;
}

/** Freie Plätze im Zeitraum: Kapazität minus die höchste gleichzeitige Belegung */
export function freeSeats(r: Pick<ResourceDef, "capacity">, taken: Taken[], startMin: number, endMin: number): number {
  const points = [startMin, ...taken.flatMap((t) => [t.startMin, t.endMin]).filter((p) => p > startMin && p < endMin)];
  let peak = 0;
  for (const p of points) {
    const used = taken.filter((t) => t.startMin <= p && t.endMin > p).reduce((a, t) => a + t.persons, 0);
    peak = Math.max(peak, used);
  }
  return r.capacity - peak;
}

/** Preis: Fenster × Preis, bei «pro Person» zusätzlich × Personen */
export function priceOf(r: ResourceDef, startMin: number, endMin: number, persons: number): number {
  const slots = (endMin - startMin) / r.slotMinutes;
  return slots * r.priceRappen * (r.pricePerPerson ? persons : 1);
}
