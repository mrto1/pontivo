"use client";
import { useId, useState } from "react";

/**
 * An/Aus-Schalter innerhalb eines Formulars (gleiches Aussehen wie unter «Funktionen»). Ersetzt die Checkbox:
 * Im Formular steht ein verstecktes Feld `name=value`, solange der Schalter an ist (wie bei einer angehakten Checkbox).
 * Gespeichert wird erst mit dem Speichern-Knopf des Formulars.
 */
export function FormSwitch({ name, value = "on", defaultOn, label, hint, disabled = false }: { name: string; value?: string; defaultOn: boolean; label: React.ReactNode; hint?: React.ReactNode; disabled?: boolean }) {
  const [on, setOn] = useState(defaultOn && !disabled);
  const id = useId();
  return (
    <div className="opt-row">
      {on && !disabled ? <input type="hidden" name={name} value={value} /> : null}
      <div className="module-text">
        <strong id={id}>{label}</strong>
        {hint ? <div className="small muted">{hint}</div> : null}
      </div>
      <button type="button" className="switch" role="switch" aria-checked={on} aria-labelledby={id} disabled={disabled} onClick={() => setOn(!on)} title={on ? "Ausschalten" : "Einschalten"}>
        <span className="switch-state">{on ? "An" : "Aus"}</span>
      </button>
    </div>
  );
}
