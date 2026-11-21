"use client";
import { useRef, useState } from "react";

export type PlanTable = { id: string; name: string; seats: number; shape: "square" | "round"; x: number | null; y: number | null; tone?: "free" | "busy" | "soon"; info?: string; href?: string };

/**
 * Grafischer Tischplan (SPEC 19.49 Etappe C). Lage in Promille der Fläche (0 bis 1000).
 * `editable`: Tische mit Maus oder Finger verschieben, Nicht-platzierte antippen zum Platzieren; «Plan speichern» schickt JSON an `action`.
 * Sonst: Anzeige mit Zustand (frei, offen, bald reserviert) und Link zur Bestellung.
 */
export function FloorPlan({ tables, editable = false, action, hotelId }: { tables: PlanTable[]; editable?: boolean; action?: (f: FormData) => void | Promise<void>; hotelId?: string }) {
  const [pos, setPos] = useState(() => new Map(tables.map((t) => [t.id, t.x === null || t.y === null ? null : { x: t.x, y: t.y }])));
  const [dirty, setDirty] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<string | null>(null);

  const move = (e: React.PointerEvent) => {
    if (!drag.current || !area.current) return;
    const r = area.current.getBoundingClientRect();
    const x = Math.round(Math.min(1000, Math.max(0, ((e.clientX - r.left) / r.width) * 1000)));
    const y = Math.round(Math.min(1000, Math.max(0, ((e.clientY - r.top) / r.height) * 1000)));
    setPos((m) => new Map(m).set(drag.current!, { x, y })); setDirty(true);
  };
  const place = (id: string) => { setPos((m) => new Map(m).set(id, { x: 500, y: 500 })); setDirty(true); };
  const remove = (id: string) => { setPos((m) => new Map(m).set(id, null)); setDirty(true); };
  const placed = tables.filter((t) => pos.get(t.id));
  const tray = tables.filter((t) => !pos.get(t.id));
  const json = JSON.stringify(tables.map((t) => ({ id: t.id, x: pos.get(t.id)?.x ?? null, y: pos.get(t.id)?.y ?? null })));

  const tile = (t: PlanTable) => {
    const p = pos.get(t.id)!;
    const cls = `plan-table ${t.shape} ${t.tone ?? ""}${editable ? " editable" : ""}`;
    const style = { left: `${p.x / 10}%`, top: `${p.y / 10}%` };
    const body = <><strong>{t.name}</strong><span className="small">{t.seats} Pl.</span>{t.info ? <span className="small">{t.info}</span> : null}</>;
    if (editable) return <div key={t.id} className={cls} style={style} role="group" aria-label={`${t.name}, verschiebbar`} data-table={t.name}
      onPointerDown={(e) => { drag.current = t.id; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }} onPointerUp={() => { drag.current = null; }}>{body}</div>;
    return t.href ? <a key={t.id} href={t.href} className={cls} style={style}>{body}</a> : <div key={t.id} className={cls} style={style}>{body}</div>;
  };

  return (
    <div className="stack">
      <div ref={area} className="plan-area" onPointerMove={editable ? move : undefined} data-testid="plan-area">
        {placed.map(tile)}
        {!placed.length ? <p className="muted plan-empty">{editable ? "Noch kein Tisch im Plan. Unten einen Tisch antippen, dann hierher ziehen." : "Noch kein Tischplan."}</p> : null}
      </div>
      {editable ? (
        <>
          {tray.length ? <div><span className="small muted">Nicht im Plan: </span>{tray.map((t) => <button key={t.id} type="button" className="btn secondary small" onClick={() => place(t.id)}>{t.name}</button>)}</div> : null}
          {placed.length ? <div><span className="small muted">Aus dem Plan nehmen: </span>{placed.map((t) => <button key={t.id} type="button" className="btn secondary small" onClick={() => remove(t.id)}>{t.name}</button>)}</div> : null}
          <form action={action}><input type="hidden" name="hotelId" value={hotelId} /><input type="hidden" name="positions" value={json} /><button className="btn" disabled={!dirty}>Plan speichern</button></form>
        </>
      ) : null}
    </div>
  );
}
