/**
 * Tischreservierungen (SPEC 19.49 Etappe C). Reine Logik ohne I/O.
 * Zeiten sind lokale Uhrzeiten 'HH:MM' des Betriebs, Tage 'YYYY-MM-DD'. Eine Reservierung belegt `durationMin` Minuten ab Beginn.
 */
export type Window = { from: string; to: string };
export type ResSettings = {
  onlineEnabled: boolean; windows: Window[]; durationMin: number; maxParty: number; capacity: number; leadHours: number; horizonDays: number;
  /** Anzahlung je Person in Rappen (0 = keine), gilt ab `depositFromParty` Personen; kostenlose Stornierung bis `cancelHours` vor Beginn */
  depositPerPersonRappen: number; depositFromParty: number; cancelHours: number; reminderHours: number; autoAssign: boolean;
  /** Vorbestellung (SPEC 19.57): erlaubt, und ab dieser Gruppengrösse Pflicht (0 = nie) */
  preorderEnabled?: boolean; preorderRequiredFrom?: number;
  /** Öffnungszeiten je Wochentag (0 = Sonntag), null/fehlend = keine Einschränkung (SPEC 20.1) */
  openingHours?: OpeningHours | null;
};
export type OpeningHours = Record<string, Window[]>;

/** Wochentag eines Tages (0 = Sonntag) */
const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** Ist der Betrieb zu dieser Zeit offen? Beginn im Zeitraum [von, bis). Ohne Öffnungszeiten immer. */
export function openAt(h: OpeningHours | null | undefined, day: string, time: string): boolean {
  if (!h) return true;
  return (h[String(weekdayOf(day))] ?? []).some((w) => toMin(time) >= toMin(w.from) && toMin(time) < toMin(w.to));
}

/** Öffnungszeiten prüfen: je Tag höchstens 3 Zeiträume, gültige Zeiten, von vor bis, ohne Überschneidung. Fehlertext oder null. */
export function checkOpeningHours(h: OpeningHours): string | null {
  const days = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  for (const [k, ws] of Object.entries(h)) {
    if (!/^[0-6]$/.test(k)) return "Wochentag ungültig.";
    if (!ws.length) continue;
    if (ws.length > 3) return `${days[Number(k)]}: höchstens 3 Zeiträume.`;
    const bad = checkWindows(ws);
    if (bad) return `${days[Number(k)]}: ${bad}`;
  }
  return null;
}
export type ResLite = { id?: string; time: string; party: number; tableId: string | null; status: string; createdAt?: Date };
/** Nicht bezahlte Online-Reservierung hält Plätze nur so lange (Stripe-Zahlungsseite läuft nach 30 Minuten ab) */
export const PENDING_MINUTES = 35;

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
const active = (r: ResLite, now: Date = new Date()) =>
  r.status === "confirmed" || r.status === "seated" || (r.status === "pending" && (!r.createdAt || now.getTime() - r.createdAt.getTime() < PENDING_MINUTES * 60_000));

/** Gäste, die gleichzeitig (überlappend) am Tisch sitzen oder erwartet werden */
export function coversAt(existing: ResLite[], time: string, dur: number): number {
  return existing.filter((r) => active(r) && overlaps(time, r.time, dur)).reduce((a, r) => a + r.party, 0);
}

/** Tisch zur Zeit noch frei? (ohne die Reservierung `ignoreId`, z. B. beim Umsetzen) */
export function tableFree(existing: ResLite[], tableId: string, time: string, dur: number, ignoreId?: string): boolean {
  return !existing.some((r) => active(r) && r.tableId === tableId && (ignoreId === undefined || r.id !== ignoreId) && overlaps(time, r.time, dur));
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
    return { time, ok: !early && openAt(s.openingHours, day, time) && coversAt(existing, time, s.durationMin) + party <= s.capacity };
  });
}

/** Anzahlung für eine Gruppe in Rappen (0 = keine) */
export const depositFor = (s: ResSettings, party: number) => (s.depositPerPersonRappen > 0 && party >= s.depositFromParty ? s.depositPerPersonRappen * party : 0);

/** Anzahlung zurückerstatten? Nur bei Storno spätestens `cancelHours` vor Beginn */
export const refundable = (s: ResSettings, startsAt: Date, now: Date) => now.getTime() <= startsAt.getTime() - s.cancelHours * 3_600_000;

/**
 * Passender Tisch: der kleinste freie mit genug Plätzen (kein Zusammenstellen mehrerer Tische).
 * Bei gleicher Grösse der erste in der Reihenfolge der Liste. Null, wenn keiner passt.
 */
export function suggestTable(tables: { id: string; seats: number }[], existing: ResLite[], party: number, time: string, dur: number, ignoreId?: string): string | null {
  const fit = tables.filter((t) => t.seats >= party && tableFree(existing, t.id, time, dur, ignoreId)).sort((a, b) => a.seats - b.seats);
  return fit[0]?.id ?? null;
}

/** Zeiträume aus Text «11:30-14:00, 17:30-22:00» (leer = Ruhetag); null bei unlesbarer Eingabe */
export function parseHoursText(t: string): Window[] | null {
  const parts = t.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  const out: Window[] = [];
  for (const p of parts) {
    const m = /^(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})$/.exec(p);
    if (!m) return null;
    out.push({ from: `${m[1].padStart(2, "0")}:${m[2]}`, to: `${m[3].padStart(2, "0")}:${m[4]}` });
  }
  return out;
}
export const hoursText = (ws: Window[] | undefined) => (ws ?? []).map((w) => `${w.from}–${w.to}`).join(", ");
export const WEEKDAYS_DE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
