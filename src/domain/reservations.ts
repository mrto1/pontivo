/**
 * Tischreservierungen (SPEC 19.49 Etappe C). Reine Logik ohne I/O.
 * Zeiten sind lokale Uhrzeiten 'HH:MM' des Betriebs, Tage 'YYYY-MM-DD'. Eine Reservierung belegt `durationMin` Minuten ab Beginn.
 */
export type Window = { from: string; to: string };
export type ResSettings = { onlineEnabled: boolean; windows: Window[]; durationMin: number; maxParty: number; capacity: number; leadHours: number; horizonDays: number };
export type ResLite = { id?: string; time: string; party: number; tableId: string | null; status: string };

export const SLOT_STEP_MIN = 30;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Fenster prüfen: gültige Zeiten, von < bis, höchstens 4, ohne Überschneidung. Fehlertext oder null. */
export function checkWindows(ws: Window[]): string | null {
  if (!ws.length) return "Mindestens ein Zeitfenster angeben.";
  if (ws.length > 4) return "Höchstens 4 Zeitfenster.";
  for (const w of ws) {
    if (!TIME_RE.test(w.from) || !TIME_RE.test(w.to)) return "Uhrzeit ungültig (HH:MM).";
    if (toMin(w.from) >= toMin(w.to)) return "Im Zeitfenster muss «von» vor «bis» liegen.";
  }
  const s = [...ws].sort((a, b) => toMin(a.from) - toMin(b.from));
  for (let i = 1; i < s.length; i++) if (toMin(s[i].from) < toMin(s[i - 1].to)) return "Die Zeitfenster überschneiden sich.";
  return null;
}

/** Beginnzeiten aller Fenster im Raster von 30 Minuten (letzter Beginn = Fensterende) */
export function slotTimes(ws: Window[]): string[] {
  const out: string[] = [];
  for (const w of ws) for (let m = toMin(w.from); m <= toMin(w.to); m += SLOT_STEP_MIN) out.push(fromMin(m));
  return out;
}

const overlaps = (a: string, b: string, dur: number) => toMin(a) < toMin(b) + dur && toMin(b) < toMin(a) + dur;
const active = (r: ResLite) => r.status === "confirmed" || r.status === "seated";

/** Gäste, die gleichzeitig (überlappend) am Tisch sitzen oder erwartet werden */
export function coversAt(existing: ResLite[], time: string, dur: number): number {
  return existing.filter((r) => active(r) && overlaps(time, r.time, dur)).reduce((a, r) => a + r.party, 0);
}

/** Tisch zur Zeit noch frei? (ohne die Reservierung `ignoreId`, z. B. beim Umsetzen) */
export function tableFree(existing: ResLite[], tableId: string, time: string, dur: number, ignoreId?: string): boolean {
  return !existing.some((r) => active(r) && r.tableId === tableId && r.id !== ignoreId && overlaps(time, r.time, dur));
}

export type Slot = { time: string; ok: boolean };

/**
 * Freie Zeiten für Gäste online. `now` = heutiger Tag und Minuten seit Mitternacht im Betrieb.
 * Nicht buchbar: Vergangenheit, näher als `leadHours`, weiter als `horizonDays`, Kapazität erschöpft.
 */
export function onlineSlots(s: ResSettings, day: string, party: number, existing: ResLite[], now: { day: string; minutes: number }, daysAhead: number): Slot[] {
  if (!s.onlineEnabled || party < 1 || party > s.maxParty || daysAhead < 0 || daysAhead > s.horizonDays) return [];
  return slotTimes(s.windows).map((time) => {
    const early = daysAhead === 0 && toMin(time) < now.minutes + s.leadHours * 60;
    return { time, ok: !early && coversAt(existing, time, s.durationMin) + party <= s.capacity };
  });
}
