import PeriodJump from "./PeriodJump";

type Jump = { kind?: "date" | "month"; value: string; param: string; keep?: Record<string, string> };

/**
 * Einheitliche Zeitnavigation für alle Seiten mit Tag, Woche oder Monat: ‹ Heute › als Pillen-Schalter,
 * dazu ein Feld zum direkten Springen. Weitere Bedienelemente (Zeitraum, Export) kommen als children daneben.
 */
export function PeriodNav({ prev, next, todayHref, todayActive, todayLabel = "Heute", prevLabel = "Zurück", nextLabel = "Vor", jump, children }: {
  prev: string; next?: string; todayHref: string; todayActive: boolean; todayLabel?: string; prevLabel?: string; nextLabel?: string; jump?: Jump; children?: React.ReactNode;
}) {
  return (
    <div className="cal-tools">
      <div className="seg" role="group" aria-label="Zeitraum verschieben">
        <a href={prev} aria-label={prevLabel} title={prevLabel}>‹</a>
        <a href={todayHref} className={todayActive ? "on" : undefined}>{todayLabel}</a>
        {next ? <a href={next} aria-label={nextLabel} title={nextLabel}>›</a> : <span className="seg-off" aria-hidden="true">›</span>}
      </div>
      {jump ? <PeriodJump {...jump} /> : null}
      {children}
    </div>
  );
}
