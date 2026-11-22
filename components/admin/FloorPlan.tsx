import type { PlanTable } from "./floor-plan-types";

/** Grafischer Tischplan, Anzeige mit Zustand (frei, offen, bald reserviert) und Link zur Bestellung. Bearbeiten: TableEditor. Lage in Promille (0 bis 1000). */
export function FloorPlan({ tables }: { tables: PlanTable[] }) {
  const placed = tables.filter((t) => t.x !== null && t.y !== null);
  return (
    <div className="plan-area" data-testid="plan-area">
      {placed.map((t) => {
        const cls = `plan-table ${t.shape} ${t.tone ?? ""}${t.dim ? " dim" : ""}`;
        const style = { left: `${t.x! / 10}%`, top: `${t.y! / 10}%` };
        const body = <><strong>{t.name}</strong><span className="small">{t.seats} Pl.</span>{t.info ? <span className="small">{t.info}</span> : null}</>;
        return t.href ? <a key={t.id} href={t.href} className={cls} style={style}>{body}</a> : <div key={t.id} className={cls} style={style}>{body}</div>;
      })}
      {!placed.length ? <p className="muted plan-empty">Noch kein Tischplan.</p> : null}
    </div>
  );
}
