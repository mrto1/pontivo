/**
 * Auswertung für die Beherbergungsstatistik (HESTA, SPEC 19.8): Ankünfte und Logiernächte nach Herkunftsland
 * sowie Zimmer- und Bettenauslastung je Monat. Reine Logik.
 * Das sind die Zahlen zum Erfassen im Portal des BFS (eHESTA); eine automatische Übermittlung gibt es nicht.
 */
import { diffDays } from "./dates";

export type StayPerson = { country: string | null; arrival: string; departure: string };
export type CountryRow = { country: string | null; arrivals: number; nights: number };

export const UNKNOWN = null;

/** Erster Tag des Folgemonats */
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
export const daysInMonth = (month: string) => diffDays(`${month}-01`, monthEnd(month));

/** Ankünfte (Anreise im Monat) und Logiernächte (Nächte im Monat) je Herkunftsland, absteigend nach Logiernächten */
export function byCountry(persons: StayPerson[], month: string): CountryRow[] {
  const from = `${month}-01`;
  const to = monthEnd(month);
  const map = new Map<string | null, CountryRow>();
  for (const p of persons) {
    const start = p.arrival > from ? p.arrival : from;
    const end = p.departure < to ? p.departure : to;
    const nights = Math.max(0, diffDays(start, end));
    const arrives = p.arrival >= from && p.arrival < to;
    if (!nights && !arrives) continue;
    const key = p.country ? p.country.toUpperCase() : null;
    const r = map.get(key) ?? { country: key, arrivals: 0, nights: 0 };
    if (arrives) r.arrivals++;
    r.nights += nights;
    map.set(key, r);
  }
  return [...map.values()].sort((a, b) => b.nights - a.nights || (a.country ?? "~").localeCompare(b.country ?? "~"));
}

export type Capacity = { roomCount: number; maxOccupancy: number };

/** Angebot und Auslastung: verfügbare Zimmernächte, belegte Zimmernächte, Betten (Summe der Höchstbelegung) */
export function occupancy(types: Capacity[], occupiedRoomNights: number, month: string) {
  const rooms = types.reduce((a, t) => a + t.roomCount, 0);
  const beds = types.reduce((a, t) => a + t.roomCount * t.maxOccupancy, 0);
  const days = daysInMonth(month);
  const availableRoomNights = rooms * days;
  return { rooms, beds, days, availableRoomNights, occupiedRoomNights, roomOccupancyPct: availableRoomNights ? Math.round((occupiedRoomNights / availableRoomNights) * 1000) / 10 : 0 };
}

export function hestaCsv(month: string, rows: CountryRow[], names: (c: string | null) => string): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["Monat", "Herkunftsland", "Code", "Ankünfte", "Logiernächte"].map(esc).join(";")];
  for (const r of rows) lines.push([month, names(r.country), r.country ?? "", r.arrivals, r.nights].map(esc).join(";"));
  lines.push([month, "Total", "", rows.reduce((a, r) => a + r.arrivals, 0), rows.reduce((a, r) => a + r.nights, 0)].map(esc).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
