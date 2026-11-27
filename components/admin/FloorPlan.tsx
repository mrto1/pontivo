"use client";
import { useState } from "react";
import { PLAN_ITEM_LABELS, chairLayout, initials, resTables, tableView, toMinutes, type ResView } from "../../src/domain/floorplan";
import type { PlanArea, PlanItemView, PlanRes, PlanTable, PlanWaiter } from "./floor-plan-types";

/**
 * Grafischer Tischplan (Anzeige, SPEC 19.53/20.1). Ein Raum pro Plan, oben Tabs zum Umschalten (Hauptsaal, Terrasse …).
 * Stühle um die Tische in Statusfarben (grün frei, orange bald/reserviert, rot besetzt), Orientierungselemente (WC, Bar …),
 * daneben die Reservationen des Tages; Antippen eines Tisches oder einer Reservation wählt beides. Bearbeiten: TableEditor.
 */
export function FloorPlan({ tables: tablesIn, areas = [], items = [], reservations = [], resLabel = "Reservationen", waiters = [], clock, openOrder }: { tables: PlanTable[]; areas?: PlanArea[]; items?: PlanItemView[]; reservations?: PlanRes[]; resLabel?: string; waiters?: PlanWaiter[]; clock?: { time: string; durationMin: number }; /** Kasse: Bestellung am Tisch eröffnen (Server Action) */ openOrder?: { action: (f: FormData) => Promise<void>; hotelId: string } }) {
  const [at, setAt] = useState(clock?.time ?? "19:00");
  const [wf, setWf] = useState("");
  const wmap = new Map(waiters.map((w) => [w.id, w]));
  // Mit Zeitregler: Zustand, Kurzinfo und Einzelheiten je Tisch aus den Reservationen zur gewählten Zeit
  const tables = clock ? tablesIn.map((t) => {
    const v = tableView(t.id, reservations.map((r) => ({ ...r, status: r.status as ResView["status"] })), at, clock.durationMin);
    const busy = !!t.busy || v.state === "seated";
    const detail = [...(t.extra ?? [])];
    if (v.cur) detail.push(`${v.cur.status === "seated" ? "Am Tisch" : "Reserviert"}: ${v.cur.name}, ${v.cur.party} Pers., ${v.cur.time} bis ${v.endCur}`);
    if (v.next) detail.push(`${v.cur ? "Danach" : "Nächste"} Reservation: ${v.next.time} ${v.next.name}, ${v.next.party} Pers.`);
    if (!v.cur && !v.next && !t.extra?.length) detail.push("Frei für den Rest des Tages.");
    return { ...t, tone: busy ? "busy" as const : v.cur || v.soon ? "soon" as const : "free" as const, info: t.busy ? t.info : v.cur ? `bis ${v.endCur}` : v.next ? `frei bis ${v.next.time}` : undefined, detail };
  }) : tablesIn;
  const first = areas[0]?.id ?? null;
  const [areaId, setAreaId] = useState<string | null>(first);
  const [sel, setSel] = useState<string | null>(null);
  const [chairs, setChairs] = useState(true);
  const inArea = (a: string | null | undefined) => areas.length < 2 || (a ?? first) === areaId;
  const placed = tables.filter((t) => t.x !== null && t.y !== null);
  const shown = placed.filter((t) => inArea(t.areaId));
  const cur = placed.find((t) => t.id === sel) ?? null;
  const tableName = (id: string | null) => tables.find((t) => t.id === id)?.name;
  const pick = (id: string | null) => {
    if (!id) return;
    const t = placed.find((x) => x.id === id);
    if (t && areas.length > 1) setAreaId(t.areaId ?? first);
    setSel((s) => (s === id ? null : id));
  };
  const hasSide = reservations.length > 0;
  return (
    <div className={hasSide ? "plan-split" : "stack"}>
      <div className="stack">
        {areas.length > 1 ? (
          <div className="seg plan-tabs" role="tablist" aria-label="Raum">
            {areas.map((a) => <button key={a.id} type="button" role="tab" aria-selected={a.id === areaId} aria-pressed={a.id === areaId} onClick={() => setAreaId(a.id)}>{a.name}</button>)}
          </div>
        ) : null}
        {clock || waiters.length ? (
          <div className="plan-controls">
            {clock ? <label className="plan-clock">Belegung um <strong>{at}</strong>
              <input type="range" min={540} max={1410} step={15} value={Math.min(1410, Math.max(540, toMinutes(at)))} aria-label="Uhrzeit" onChange={(e) => { const m = Number(e.target.value); setAt(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`); }} /></label> : null}
            {waiters.length ? <label className="small">Kellner <select value={wf} onChange={(e) => setWf(e.target.value)} aria-label="Kellner hervorheben"><option value="">alle</option>{waiters.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label> : null}
          </div>
        ) : null}
        <div className="plan-area" data-testid="plan-area">
          {items.filter((i) => inArea(i.areaId)).map((i) => (
            <div key={i.id} className={`plan-item kind-${i.kind}`} style={{ left: `${i.x / 10}%`, top: `${i.y / 10}%`, width: `${i.w / 10}%`, height: `${i.h / 10}%` }} aria-label={i.label || PLAN_ITEM_LABELS[i.kind as keyof typeof PLAN_ITEM_LABELS]}>
              <span>{i.label || PLAN_ITEM_LABELS[i.kind as keyof typeof PLAN_ITEM_LABELS] || ""}</span>
            </div>
          ))}
          {shown.map((t) => (
            <button key={t.id} type="button" className={`plan-table ${t.shape} ${t.tone ?? ""}${t.dim || (wf && t.waiterId !== wf) ? " dim" : ""}${t.id === sel ? " selected" : ""}`} style={{ left: `${t.x! / 10}%`, top: `${t.y! / 10}%` }}
              aria-pressed={t.id === sel} aria-label={`${t.name}, ${t.seats} Plätze${t.info ? `, ${t.info}` : ""}`} onClick={() => pick(t.id)}>
              {chairs ? chairLayout(t.seats, t.shape).map((c, i) => <i key={i} className="plan-chair" style={{ left: `${50 + c.x * 50}%`, top: `${50 + c.y * 50}%` }} aria-hidden="true" />) : null}
              {t.waiterId && wmap.get(t.waiterId) ? <b className="plan-waiter" style={{ background: wmap.get(t.waiterId)!.color }} title={wmap.get(t.waiterId)!.name}>{initials(wmap.get(t.waiterId)!.name)}</b> : null}<strong>{t.name}</strong><span className="small">{t.seats} Pl.</span>{t.info ? <span className="plan-info">{t.info}</span> : null}
            </button>
          ))}
          {!shown.length ? <p className="muted plan-empty">{placed.length ? "In diesem Raum steht noch kein Tisch." : "Noch kein Tischplan."}</p> : null}
        </div>
        <div className="plan-legend small muted">
          <span><i className="plan-chair free" /> frei</span><span><i className="plan-chair soon" /> reserviert / bald</span><span><i className="plan-chair busy" /> besetzt</span>
          <label className="te-plan"><input type="checkbox" checked={chairs} onChange={(e) => setChairs(e.target.checked)} /><span>Stühle</span></label>
        </div>
        {cur ? (
          <div className="card stack plan-detail" aria-live="polite">
            <strong>{cur.name} <span className="small muted">· {cur.seats} Plätze</span></strong>
            {(cur.detail ?? (cur.info ? [cur.info] : [])).map((l, i) => <div key={i} className="small">{l}</div>)}
            {cur.href || cur.links?.length || (openOrder && cur.openLabel) ? (
              <div className="inline-form">
                {cur.href ? <a className="btn secondary small" href={cur.href}>{cur.hrefLabel ?? "Öffnen"}</a> : null}
                {cur.links?.map((l) => <a key={l.href} className="btn secondary small" href={l.href}>{l.label}</a>)}
                {openOrder && cur.openLabel ? <form action={openOrder.action}><input type="hidden" name="hotelId" value={openOrder.hotelId} /><input type="hidden" name="tableId" value={cur.id} /><button className="btn small">{cur.openLabel}</button></form> : null}
              </div>
            ) : null}
          </div>
        ) : placed.length ? <p className="small muted m0">Tisch antippen für Einzelheiten.</p> : null}
      </div>
      {hasSide ? (
        <aside className="card stack plan-side" aria-label={resLabel}>
          <h2>{resLabel} <span className="small muted">({reservations.length})</span></h2>
          <ul className="plan-res">
            {reservations.map((r) => (
              <li key={r.id}>
                <button type="button" className={`plan-res-row${sel && resTables(r).includes(sel) ? " selected" : ""}`} onClick={() => pick(r.tableId)} disabled={!r.tableId}>
                  <strong>{r.time}</strong>
                  <span>{r.name}<span className="small muted"> · {r.party} Pers.{r.status === "seated" ? " · am Tisch" : ""}</span></span>
                  <span className="small muted">{resTables(r).length ? resTables(r).map((x) => tableName(x) ?? "?").join(" + ") : "ohne Tisch"}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
