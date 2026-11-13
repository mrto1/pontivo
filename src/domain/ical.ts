import { addDays, diffDays, isDay, todayIn, type Day } from "./dates";

/** Reine iCal-Logik (SPEC 7b): Kalender lesen und schreiben, ohne I/O. */

export const MAX_EVENTS = 2000;

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function ymd(v: string): Day | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
  if (!m) return null;
  const d = `${m[1]}-${m[2]}-${m[3]}`;
  return isDay(d) ? d : null;
}

/** Kalendertag eines iCal-Wertes; Zeitpunkte in UTC ("…Z") werden in die Zeitzone des Hotels umgerechnet */
function dayOf(value: string, tz: string): Day | null {
  const v = value.trim();
  const z = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v);
  if (z) return todayIn(tz, new Date(Date.UTC(+z[1], +z[2] - 1, +z[3], +z[4], +z[5], +z[6])));
  return ymd(v);
}

export type IcalParse = { ok: true; nights: Set<Day>; events: number } | { ok: false; error: string };

/**
 * Belegte Nächte aus einem iCal-Text. DTEND ist exklusiv (Abreisetag). Stornierte Ereignisse zählen nicht.
 * Nur Nächte ab `today` bis `horizonEnd` (exklusiv) werden geliefert.
 */
// ASSUMPTION: Wiederholungen (RRULE) werden nicht aufgelöst; Airbnb, Booking.com und Vrbo verwenden sie für Belegungen nicht.
export function parseIcal(text: string, tz: string, today: Day, horizonEnd: Day): IcalParse {
  const lines = unfold(text);
  if (!lines.some((l) => l.trim().toUpperCase() === "BEGIN:VCALENDAR")) return { ok: false, error: "Das ist keine iCal-Datei" };
  const nights = new Set<Day>();
  let events = 0;
  let cur: Record<string, string> | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const up = line.toUpperCase();
    if (up === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (up === "END:VEVENT") {
      const ev = cur;
      cur = null;
      if (!ev || ev.STATUS?.toUpperCase() === "CANCELLED" || !ev.DTSTART) continue;
      if (++events > MAX_EVENTS) return { ok: false, error: "Zu viele Einträge im Kalender" };
      const start = dayOf(ev.DTSTART, tz);
      if (!start) continue;
      let end = ev.DTEND ? dayOf(ev.DTEND, tz) : null;
      if (!end || diffDays(start, end) < 1) end = addDays(start, 1); // mindestens eine Nacht
      if (diffDays(start, end) > 400) end = addDays(start, 400);
      for (let d = start < today ? today : start; d < end && d < horizonEnd; d = addDays(d, 1)) nights.add(d);
      continue;
    }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 1) continue;
    const name = line.slice(0, i).split(";")[0].toUpperCase();
    if (name === "DTSTART" || name === "DTEND" || name === "STATUS") cur[name] = line.slice(i + 1);
  }
  return { ok: true, nights, events };
}

function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function compact(d: Day) {
  return d.replace(/-/g, "");
}

/** Zusammenhängende Nächte zu [von, bis-exklusiv)-Bereichen */
export function nightRanges(nights: Day[]): { from: Day; to: Day }[] {
  const out: { from: Day; to: Day }[] = [];
  for (const d of [...nights].sort()) {
    const last = out[out.length - 1];
    if (last && last.to === d) last.to = addDays(d, 1);
    else out.push({ from: d, to: addDays(d, 1) });
  }
  return out;
}

/** Feed mit den ausverkauften Nächten (nur «Belegt», keine Gästedaten). Zeilen max. 75 Zeichen wären nur bei langen Namen relevant. */
export function buildIcal(calName: string, roomTypeId: string, soldOutNights: Day[], now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pontivo//Belegung//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(calName)}`];
  for (const r of nightRanges(soldOutNights)) {
    out.push(
      "BEGIN:VEVENT",
      `UID:${roomTypeId}-${compact(r.from)}@pontivo`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(r.from)}`,
      `DTEND;VALUE=DATE:${compact(r.to)}`,
      "SUMMARY:Belegt",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  out.push("END:VCALENDAR");
  return out.join("\r\n") + "\r\n";
}
