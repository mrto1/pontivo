/**
 * Direktbuchungs-Werkzeuge (SPEC 19.29), reine Logik ohne I/O:
 * Direktvorteile, Lückenfüller (kurze Lücken zwischen ausgebuchten Nächten), Rabatt, Firmencodes, Warteliste, Abbruch-Mail.
 */
import { addDays, diffDays, nightsOf, type Day } from "./dates";
import { fallbackChain, type Locale } from "../i18n/dict";

export type Benefit = { id: string; text: Partial<Record<Locale, string>>; minNights?: number };

export type DirectSettings = {
  /** «Nur bei Direktbuchung»-Vorteile, im Buchungsfenster und in der Bestätigung */
  benefits?: { enabled?: boolean; items?: Benefit[] };
  /** Lückenfüller: ein Aufenthalt, der eine kurze Lücke genau füllt, darf den Mindestaufenthalt unterschreiten und kann günstiger sein */
  gaps?: { enabled?: boolean; maxNights?: number; discountBps?: number; relaxMinStay?: boolean };
  /** Abbruch-Mail: einmalige Erinnerung nach einer nicht bezahlten Reservation (Standard aus) */
  recovery?: { enabled?: boolean };
  /** Warteliste bei Ausgebucht (Standard an) */
  waitlist?: { enabled?: boolean };
  /** Wiederkehr-Mail: einmalige Einladung rund ein Jahr nach dem Aufenthalt, nur Gäste mit Werbe-Einwilligung (Standard aus) */
  winback?: { enabled?: boolean; afterDays?: number };
};

export const MAX_BENEFITS = 4;
export const BENEFIT_MAX_LEN = 90;
export const MAX_GAP_NIGHTS = 3;
export const MAX_GAP_DISCOUNT_BPS = 3000;
export const MAX_CODE_DISCOUNT_BPS = 5000;

// ---------------------------------------------------------------- Einstellungen

export const gapSettings = (d?: DirectSettings) => ({
  enabled: d?.gaps?.enabled === true,
  maxNights: Math.min(MAX_GAP_NIGHTS, Math.max(1, Math.round(d?.gaps?.maxNights ?? 2))),
  discountBps: Math.min(MAX_GAP_DISCOUNT_BPS, Math.max(0, Math.round(d?.gaps?.discountBps ?? 0))),
  relaxMinStay: d?.gaps?.relaxMinStay !== false,
});
export const waitlistEnabled = (d?: DirectSettings) => d?.waitlist?.enabled !== false;
export const WINBACK_MIN_DAYS = 200;
export const WINBACK_MAX_DAYS = 400;
export const WINBACK_DEFAULT_DAYS = 330;
// ASSUMPTION: 330 Tage nach der Abreise (gut 11 Monate): Einladung rund einen Monat vor dem Jahrestag des Aufenthalts.
export const winbackSettings = (d?: DirectSettings) => ({
  enabled: d?.winback?.enabled === true,
  afterDays: Math.min(WINBACK_MAX_DAYS, Math.max(WINBACK_MIN_DAYS, Math.round(d?.winback?.afterDays ?? WINBACK_DEFAULT_DAYS))),
});
export const recoveryEnabled = (d?: DirectSettings) => d?.recovery?.enabled === true;

// ---------------------------------------------------------------- Direktvorteile

/** Bereinigt die Eingabe: höchstens 4 Vorteile, Text gekürzt, leere weg, Mindestnächte 1 bis 30 */
export function cleanBenefits(items: { id?: string; text: Partial<Record<Locale, string>>; minNights?: number | null }[]): Benefit[] {
  const out: Benefit[] = [];
  for (const it of items) {
    const text: Partial<Record<Locale, string>> = {};
    for (const [k, v] of Object.entries(it.text ?? {})) {
      const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, BENEFIT_MAX_LEN);
      if (s) text[k as Locale] = s;
    }
    if (!text.de) continue; // Deutsch ist die Ausgangssprache
    const n = Math.round(Number(it.minNights ?? 0));
    out.push({ id: it.id || `b${out.length + 1}`, text, ...(n > 1 ? { minNights: Math.min(30, n) } : {}) });
    if (out.length >= MAX_BENEFITS) break;
  }
  return out;
}

/** Vorteile, die für einen Aufenthalt von `nights` Nächten gelten */
export function benefitsFor(d: DirectSettings | undefined, nights: number): Benefit[] {
  if (!d?.benefits?.enabled) return [];
  return (d.benefits.items ?? []).filter((b) => nights >= (b.minNights ?? 1));
}

export function benefitText(text: Partial<Record<Locale, string>>, lang: Locale): string {
  for (const l of fallbackChain(lang)) if (text[l]) return text[l]!;
  return text.de ?? Object.values(text)[0] ?? "";
}

// ---------------------------------------------------------------- Rabatt

/** Preis nach Rabatt in Basispunkten (1000 = 10 %), nie unter 1 Rappen */
export function applyDiscount(priceRappen: number, bps: number): number {
  if (bps <= 0) return priceRappen;
  return Math.max(1, Math.round((priceRappen * (10_000 - bps)) / 10_000));
}

export type Adjustment = { kind: "company" | "gap"; bps: number };

/** Es gilt nur der höhere Rabatt, nie beide zusammen */
export function bestAdjustment(list: (Adjustment | null | undefined)[]): Adjustment | null {
  let best: Adjustment | null = null;
  for (const a of list) if (a && a.bps > 0 && (!best || a.bps > best.bps)) best = a;
  return best;
}

// ---------------------------------------------------------------- Lücken

/** Eine Nacht eines Zimmertyps: frei = noch mindestens ein Zimmer verkäuflich */
export type GapNight = { night: Day; free: number };

/**
 * Füllt der Aufenthalt checkin..checkout genau eine Lücke? Davor und danach muss eine ausgebuchte Nacht stehen
 * (die Zeilen für diese beiden Nächte müssen mitgegeben werden), alle Nächte dazwischen sind frei, und es sind höchstens `maxNights`.
 */
export function fillsGap(nights: GapNight[], checkin: Day, checkout: Day, maxNights: number): boolean {
  const n = diffDays(checkin, checkout);
  if (n < 1 || n > maxNights) return false;
  const by = new Map(nights.map((x) => [x.night, x.free]));
  const before = by.get(addDays(checkin, -1));
  const after = by.get(checkout);
  if (before === undefined || after === undefined || before > 0 || after > 0) return false;
  return nightsOf(checkin, checkout).every((d) => (by.get(d) ?? 0) > 0);
}

export type Gap = { from: Day; to: Day; nights: number };

/**
 * Alle Lücken ab `today`: zusammenhängende freie Nächte (höchstens `maxNights`), vorher und nachher ausgebucht.
 * `nights` muss zusammenhängend und nach Datum sortiert sein; Läufe am Rand der Daten zählen nicht (Nachbar unbekannt).
 */
export function findGaps(nights: GapNight[], today: Day, maxNights: number): Gap[] {
  const out: Gap[] = [];
  const sorted = [...nights].sort((a, b) => a.night.localeCompare(b.night));
  let i = 0;
  while (i < sorted.length) {
    if (sorted[i].free > 0) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1].free > 0 && diffDays(sorted[j].night, sorted[j + 1].night) === 1) j++;
      const prev = sorted[i - 1], next = sorted[j + 1];
      const len = j - i + 1;
      if (prev && next && prev.free <= 0 && next.free <= 0 && diffDays(prev.night, sorted[i].night) === 1 && diffDays(sorted[j].night, next.night) === 1
        && len <= maxNights && sorted[i].night >= today) {
        out.push({ from: sorted[i].night, to: addDays(sorted[j].night, 1), nights: len });
      }
      i = j + 1;
    } else i++;
  }
  return out;
}

// ---------------------------------------------------------------- Firmencode

export const CODE_RE = /^[A-Z0-9-]{4,24}$/;

/** Gross, ohne Leerzeichen; null wenn kein gültiges Format */
export function normalizeCode(s: string | null | undefined): string | null {
  const c = String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return CODE_RE.test(c) ? c : null;
}

/** Gilt der Code für diese Anreise? (Zeitraum bezieht sich auf das Anreisedatum) */
export function codeUsable(c: { active: boolean; validFrom: Day | null; validUntil: Day | null }, checkin: Day): boolean {
  if (!c.active) return false;
  if (c.validFrom && checkin < c.validFrom) return false;
  if (c.validUntil && checkin > c.validUntil) return false;
  return true;
}

// ---------------------------------------------------------------- Abbruch-Mail

/** Reservation abgelaufen vor mindestens 30 Minuten und höchstens 24 Stunden: Zeit für die einmalige Erinnerung */
export const RECOVERY_AFTER_MIN = 30;
export const RECOVERY_WITHIN_HOURS = 24;
