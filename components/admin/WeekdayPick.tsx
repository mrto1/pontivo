"use client";
import { useState } from "react";

const NAMES = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * Wochentage als sieben Kacheln (0 = Sonntag). Normale Checkboxen im Formular (Name = `name`, Wert = Tag),
 * dazu Kurzwahl «Alle / Wochenende / Keiner» und ein Hinweis, der live sagt, was gilt. Keiner gewählt = jeder Tag.
 */
export function WeekdayPick({ name, defaultValues = [], disabled = false }: { name: string; defaultValues?: number[]; disabled?: boolean }) {
  const [sel, setSel] = useState<number[]>(defaultValues);
  const set = (days: number[]) => setSel(days);
  const toggle = (d: number) => setSel((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]));
  const hint = sel.length === 0 || sel.length === 7 ? "Jeder Tag" : `Nur ${ORDER.filter((d) => sel.includes(d)).map((d) => NAMES[d]).join(", ")}`;
  return (
    <div>
      <div className="weekdays wd7">
        {ORDER.map((d) => (
          <label key={d}><input type="checkbox" name={name} value={d} checked={sel.includes(d)} onChange={() => toggle(d)} disabled={disabled} />{NAMES[d]}</label>
        ))}
      </div>
      <p className="small muted m0 mt8" aria-live="polite">{hint}</p>
      {disabled ? null : (
        <div className="wd-quick small">
          <button type="button" className="link-btn" onClick={() => set(ORDER)}>Alle</button>
          <button type="button" className="link-btn" onClick={() => set([6, 0])}>Wochenende</button>
          <button type="button" className="link-btn" onClick={() => set([])}>Keiner</button>
        </div>
      )}
    </div>
  );
}
