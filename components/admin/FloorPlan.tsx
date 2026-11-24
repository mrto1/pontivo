"use client";
import { useState } from "react";
import type { PlanTable } from "./floor-plan-types";

/**
 * Grafischer Tischplan (Anzeige, SPEC 20.1). Im Tisch nur Name, Plätze und eine kurze Zeile (z. B. «frei bis 20:00»);
 * Einzelheiten und Link erscheinen nach dem Antippen unter dem Plan. Abgeblendet: Tisch passt nicht zum Filter. Bearbeiten: TableEditor.
 */
export function FloorPlan({ tables }: { tables: PlanTable[] }) {
  const [sel, setSel] = useState<string | null>(null);
  const placed = tables.filter((t) => t.x !== null && t.y !== null);
  const cur = placed.find((t) => t.id === sel) ?? null;
  return (
    <div className="stack">
      <div className="plan-area" data-testid="plan-area">
        {placed.map((t) => (
          <button key={t.id} type="button" className={`plan-table ${t.shape} ${t.tone ?? ""}${t.dim ? " dim" : ""}${t.id === sel ? " selected" : ""}`} style={{ left: `${t.x! / 10}%`, top: `${t.y! / 10}%` }}
            aria-pressed={t.id === sel} aria-label={`${t.name}, ${t.seats} Plätze${t.info ? `, ${t.info}` : ""}`} onClick={() => setSel(t.id === sel ? null : t.id)}>
            <strong>{t.name}</strong><span className="small">{t.seats} Pl.</span>{t.info ? <span className="plan-info">{t.info}</span> : null}
          </button>
        ))}
        {!placed.length ? <p className="muted plan-empty">Noch kein Tischplan.</p> : null}
      </div>
      {cur ? (
        <div className="card stack plan-detail" aria-live="polite">
          <strong>{cur.name} <span className="small muted">· {cur.seats} Plätze</span></strong>
          {(cur.detail ?? (cur.info ? [cur.info] : [])).map((l, i) => <div key={i} className="small">{l}</div>)}
          {cur.href ? <div><a className="btn secondary small" href={cur.href}>{cur.hrefLabel ?? "Öffnen"}</a></div> : null}
        </div>
      ) : placed.length ? <p className="small muted m0">Tisch antippen für Einzelheiten.</p> : null}
    </div>
  );
}
