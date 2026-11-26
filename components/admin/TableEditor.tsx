"use client";
import { useRef, useState } from "react";
import { PLAN_ITEM_KINDS, PLAN_ITEM_LABELS, chairLayout, clampPlan } from "../../src/domain/floorplan";
import type { PlanArea, PlanWaiter } from "./floor-plan-types";

export type EditTable = { id: string; name: string; seats: number; shape: "square" | "round" | "rect"; x: number | null; y: number | null; areaId: string; waiterId: string | null; online: boolean };
export type EditItem = { key: string; areaId: string; kind: string; label: string; x: number; y: number; w: number; h: number };

/**
 * Tischplan bearbeiten (SPEC 19.53): Raum-Tabs, Liste mit Plätzen, Form, Raum und «Im Plan» je Tisch, Elemente (WC, Bar …) und die Fläche
 * zum Verschieben. Ein Speichern-Knopf schickt alles als JSON an `action`. Lage in Promille (0 bis 1000).
 */
export function TableEditor({ tables, areas, waiters = [], items, action, hotelId }: { tables: EditTable[]; areas: PlanArea[]; waiters?: PlanWaiter[]; items: EditItem[]; action: (f: FormData) => void | Promise<void>; hotelId: string }) {
  const [rows, setRows] = useState(tables);
  const [its, setIts] = useState(items);
  const [areaId, setAreaId] = useState(areas[0].id);
  const [selItem, setSelItem] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "table" | "item"; id: string } | null>(null);
  const patch = (id: string, p: Partial<EditTable>) => { setRows((r) => r.map((t) => (t.id === id ? { ...t, ...p } : t))); setDirty(true); };
  const patchItem = (key: string, p: Partial<EditItem>) => { setIts((r) => r.map((t) => (t.key === key ? { ...t, ...p } : t))); setDirty(true); };
  const pos = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return { x: clampPlan(((e.clientX - r.left) / r.width) * 1000), y: clampPlan(((e.clientY - r.top) / r.height) * 1000) };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !area.current) return;
    const p = pos(e);
    if (d.kind === "table") patch(d.id, p);
    else { const it = its.find((i) => i.key === d.id); if (it) patchItem(d.id, { x: clampPlan(p.x - it.w / 2), y: clampPlan(p.y - it.h / 2) }); }
  };
  const addItem = (kind: string) => {
    const key = `n${Date.now()}${its.length}`;
    setIts((r) => [...r, { key, areaId, kind, label: "", x: 420, y: 440, w: kind === "wall" ? 200 : 100, h: kind === "wall" ? 20 : 70 }]);
    setSelItem(key); setDirty(true);
  };
  const shownTables = rows.filter((t) => t.areaId === areaId && t.x !== null && t.y !== null);
  const shownItems = its.filter((i) => i.areaId === areaId);
  const cur = its.find((i) => i.key === selItem) ?? null;
  const json = JSON.stringify({
    tables: rows.map((t) => ({ id: t.id, areaId: t.areaId, waiterId: t.waiterId, online: t.online, seats: t.seats, shape: t.shape, x: t.x, y: t.y })),
    items: its.map((i) => ({ areaId: i.areaId, kind: i.kind, label: i.label, x: i.x, y: i.y, w: i.w, h: i.h })),
  });

  return (
    <form action={action} className="stack">
      <input type="hidden" name="hotelId" value={hotelId} />
      <input type="hidden" name="layout" value={json} />
      <div className="te-list" role="table" aria-label="Tische">
        <div className="te-row te-head" role="row"><span role="columnheader">Tisch</span><span role="columnheader">Plätze</span><span role="columnheader">Form</span><span role="columnheader">Raum</span>{waiters.length ? <span role="columnheader">Kellner</span> : null}<span role="columnheader">Online</span><span role="columnheader">Im Plan</span></div>
        {rows.map((t) => (
          <div key={t.id} className="te-row" role="row">
            <strong>{t.name}</strong>
            <input aria-label={`Plätze ${t.name}`} type="number" min={1} max={50} value={t.seats} onChange={(e) => patch(t.id, { seats: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />
            <div className="seg" role="group" aria-label={`Form ${t.name}`}>
              <button type="button" aria-pressed={t.shape === "square"} onClick={() => patch(t.id, { shape: "square" })}>eckig</button>
              <button type="button" aria-pressed={t.shape === "rect"} onClick={() => patch(t.id, { shape: "rect" })}>länglich</button>
              <button type="button" aria-pressed={t.shape === "round"} onClick={() => patch(t.id, { shape: "round" })}>rund</button>
            </div>
            <select aria-label={`Raum ${t.name}`} value={t.areaId} onChange={(e) => patch(t.id, { areaId: e.target.value })}>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            {waiters.length ? <select aria-label={`Kellner ${t.name}`} value={t.waiterId ?? ""} onChange={(e) => patch(t.id, { waiterId: e.target.value || null })}><option value="">–</option>{waiters.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select> : null}
            <label className="te-plan"><input type="checkbox" aria-label={`Online buchbar ${t.name}`} checked={t.online} onChange={(e) => patch(t.id, { online: e.target.checked })} /><span className="small">Online</span></label>
            <label className="te-plan"><input type="checkbox" checked={t.x !== null} onChange={(e) => patch(t.id, e.target.checked ? { x: 500, y: 500 } : { x: null, y: null })} /><span className="small">Im Plan</span></label>
          </div>
        ))}
      </div>
      {areas.length > 1 ? (
        <div className="seg plan-tabs" role="tablist" aria-label="Raum bearbeiten">
          {areas.map((a) => <button key={a.id} type="button" role="tab" aria-selected={a.id === areaId} aria-pressed={a.id === areaId} onClick={() => { setAreaId(a.id); setSelItem(null); }}>{a.name}</button>)}
        </div>
      ) : null}
      <div className="te-palette" role="group" aria-label="Elemente hinzufügen">
        <span className="small muted">Element hinzufügen:</span>
        {PLAN_ITEM_KINDS.map((k) => <button key={k} type="button" className="btn secondary small" onClick={() => addItem(k)}>{PLAN_ITEM_LABELS[k]}</button>)}
      </div>
      <p className="small muted">Tische und Elemente mit Maus oder Finger an ihren Ort ziehen. Tische sind einem Raum zugeordnet; jeder Raum hat seinen eigenen Plan.</p>
      <div ref={area} className="plan-area" onPointerMove={move} data-testid="plan-area">
        {shownItems.map((i) => (
          <div key={i.key} className={`plan-item kind-${i.kind} editable${i.key === selItem ? " selected" : ""}`} style={{ left: `${i.x / 10}%`, top: `${i.y / 10}%`, width: `${i.w / 10}%`, height: `${i.h / 10}%`, cursor: "grab" }} role="group" aria-label={`${i.label || PLAN_ITEM_LABELS[i.kind as keyof typeof PLAN_ITEM_LABELS]}, verschiebbar`}
            onPointerDown={(e) => { drag.current = { kind: "item", id: i.key }; setSelItem(i.key); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }} onPointerUp={() => { drag.current = null; }}>
            <span>{i.label || PLAN_ITEM_LABELS[i.kind as keyof typeof PLAN_ITEM_LABELS]}</span>
          </div>
        ))}
        {shownTables.map((t) => (
          <div key={t.id} className={`plan-table ${t.shape} editable`} style={{ left: `${t.x! / 10}%`, top: `${t.y! / 10}%` }} role="group" aria-label={`${t.name}, verschiebbar`} data-table={t.name}
            onPointerDown={(e) => { drag.current = { kind: "table", id: t.id }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }} onPointerUp={() => { drag.current = null; }}>
            {chairLayout(t.seats, t.shape).map((c, n) => <i key={n} className="plan-chair" style={{ left: `${50 + c.x * 50}%`, top: `${50 + c.y * 50}%` }} aria-hidden="true" />)}
            <strong>{t.name}</strong><span className="small">{t.seats} Pl.</span>
          </div>
        ))}
        {!shownTables.length && !shownItems.length ? <p className="muted plan-empty">Dieser Raum ist leer. Tische mit «Im Plan» und dem passenden Raum zeigen, Elemente oben hinzufügen.</p> : null}
      </div>
      {cur && cur.areaId === areaId ? (
        <div className="card te-item-edit">
          <strong>{PLAN_ITEM_LABELS[cur.kind as keyof typeof PLAN_ITEM_LABELS]}</strong>
          <div><label htmlFor="il">Beschriftung</label><input id="il" maxLength={40} value={cur.label} onChange={(e) => patchItem(cur.key, { label: e.target.value })} /></div>
          <div><label htmlFor="iw">Breite</label><input id="iw" type="number" min={10} max={1000} step={10} value={cur.w} onChange={(e) => patchItem(cur.key, { w: Math.max(10, Math.min(1000, Number(e.target.value) || 10)) })} /></div>
          <div><label htmlFor="ih">Höhe</label><input id="ih" type="number" min={10} max={1000} step={10} value={cur.h} onChange={(e) => patchItem(cur.key, { h: Math.max(10, Math.min(1000, Number(e.target.value) || 10)) })} /></div>
          <button type="button" className="btn secondary small" onClick={() => { setIts((r) => r.filter((i) => i.key !== cur.key)); setSelItem(null); setDirty(true); }}>Element entfernen</button>
        </div>
      ) : null}
      <div className="te-save"><button className="btn" disabled={!dirty}>Änderungen speichern</button>{dirty ? <span className="small muted">Nicht gespeicherte Änderungen</span> : null}</div>
    </form>
  );
}
