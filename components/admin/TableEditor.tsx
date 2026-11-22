"use client";
import { useRef, useState } from "react";

export type EditTable = { id: string; name: string; seats: number; shape: "square" | "round"; x: number | null; y: number | null };

/**
 * Tischplan bearbeiten (SPEC 20.1): eine Liste mit Plätzen, Form und «Im Plan» je Tisch, darunter die Fläche zum Verschieben.
 * Ein einziger Speichern-Knopf unten (fest am Rand sichtbar) schickt alles als JSON an `action`. Lage in Promille (0 bis 1000).
 */
export function TableEditor({ tables, action, hotelId }: { tables: EditTable[]; action: (f: FormData) => void | Promise<void>; hotelId: string }) {
  const [rows, setRows] = useState(tables);
  const [dirty, setDirty] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<string | null>(null);
  const patch = (id: string, p: Partial<EditTable>) => { setRows((r) => r.map((t) => (t.id === id ? { ...t, ...p } : t))); setDirty(true); };
  const move = (e: React.PointerEvent) => {
    if (!drag.current || !area.current) return;
    const r = area.current.getBoundingClientRect();
    patch(drag.current, {
      x: Math.round(Math.min(1000, Math.max(0, ((e.clientX - r.left) / r.width) * 1000))),
      y: Math.round(Math.min(1000, Math.max(0, ((e.clientY - r.top) / r.height) * 1000))),
    });
  };
  const placed = rows.filter((t) => t.x !== null && t.y !== null);
  const json = JSON.stringify(rows.map((t) => ({ id: t.id, seats: t.seats, shape: t.shape, x: t.x, y: t.y })));

  return (
    <form action={action} className="stack">
      <input type="hidden" name="hotelId" value={hotelId} />
      <input type="hidden" name="tables" value={json} />
      <div className="te-list" role="table" aria-label="Tische">
        <div className="te-row te-head" role="row"><span role="columnheader">Tisch</span><span role="columnheader">Plätze</span><span role="columnheader">Form</span><span role="columnheader">Im Plan</span></div>
        {rows.map((t) => (
          <div key={t.id} className="te-row" role="row">
            <strong>{t.name}</strong>
            <input aria-label={`Plätze ${t.name}`} type="number" min={1} max={50} value={t.seats} onChange={(e) => patch(t.id, { seats: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />
            <div className="seg" role="group" aria-label={`Form ${t.name}`}>
              <button type="button" aria-pressed={t.shape === "square"} onClick={() => patch(t.id, { shape: "square" })}>eckig</button>
              <button type="button" aria-pressed={t.shape === "round"} onClick={() => patch(t.id, { shape: "round" })}>rund</button>
            </div>
            <label className="switch"><input type="checkbox" role="switch" checked={t.x !== null} onChange={(e) => patch(t.id, e.target.checked ? { x: 500, y: 500 } : { x: null, y: null })} /><span className="small">{t.x !== null ? "ja" : "nein"}</span></label>
          </div>
        ))}
      </div>
      <p className="small muted">Tische im Plan mit Maus oder Finger an ihren Ort ziehen.</p>
      <div ref={area} className="plan-area" onPointerMove={move} data-testid="plan-area">
        {placed.map((t) => (
          <div key={t.id} className={`plan-table ${t.shape} editable`} style={{ left: `${t.x! / 10}%`, top: `${t.y! / 10}%` }} role="group" aria-label={`${t.name}, verschiebbar`} data-table={t.name}
            onPointerDown={(e) => { drag.current = t.id; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }} onPointerUp={() => { drag.current = null; }}>
            <strong>{t.name}</strong><span className="small">{t.seats} Pl.</span>
          </div>
        ))}
        {!placed.length ? <p className="muted plan-empty">Noch kein Tisch im Plan. In der Liste «Im Plan» einschalten.</p> : null}
      </div>
      <div className="te-save"><button className="btn" disabled={!dirty}>Änderungen speichern</button>{dirty ? <span className="small muted">Nicht gespeicherte Änderungen</span> : null}</div>
    </form>
  );
}
