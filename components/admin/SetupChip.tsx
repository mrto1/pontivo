"use client";
import { useArea } from "./AreaContext";

/**
 * Stand der Einrichtung in der Kopfzeile. Bei Betrieben mit Unterkunft und Gastronomie folgt er dem Bereich:
 * Unterkunft zählt die Schritte des Einrichtungsassistenten, Gastronomie die Checkliste «Bereit für den Betrieb».
 * Auf dem Handy nur «5/10» (das Wort «Einrichtung» fällt weg).
 */
export type Progress = { done: number; total: number; href: string; title: string };

export function SetupChip({ lodging, dining, split }: { lodging: Progress | null; dining: Progress | null; /** Betrieb mit beiden Bereichen: je Bereich ein eigener Stand */ split: boolean }) {
  const area = useArea()?.area ?? "lodging";
  const p = split && area === "dining" ? dining : lodging;
  if (!p) return null;
  return (
    <a href={p.href} className="setup-chip" title={p.title} aria-label={`${p.title}: ${p.done} von ${p.total}`}>
      <span className="chip-word">Einrichtung </span>{p.done}/{p.total}
    </a>
  );
}
