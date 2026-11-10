import type { MonthRow } from "@/src/services/overview";

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const label = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1];

/** Balken mit 4px runden Ecken oben, unten auf der Grundlinie */
function bar(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(v: number) {
  if (v <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * step >= v) return f * step;
  return 10 * step;
}

/**
 * Buchungen pro Monat: direkt gegenüber Portalen (letzte 12 Monate). Server-SVG, Hover über <title>,
 * Tabellenansicht darunter. Farben: --viz-direct / --viz-portal (app/globals.css, hell und dunkel geprüft).
 */
export function DirectChart({ data }: { data: MonthRow[] }) {
  const W = 720, H = 220, L = 32, B = 26, T = 10;
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.direct, d.portal))));
  const ticks = [0, max / 2, max];
  const slot = (W - L) / data.length;
  const bw = Math.min(18, (slot - 10) / 2);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const base = y(0);
  return (
    <figure className="viz" style={{ margin: 0 }}>
      <div className="viz-legend" aria-hidden="true">
        <span><i style={{ background: "var(--viz-direct)" }} />Direkt (Pontivo)</span>
        <span><i style={{ background: "var(--viz-portal)" }} />Buchungsportale</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Buchungen pro Monat, direkt und über Portale, letzte 12 Monate" style={{ width: "100%", height: "auto", display: "block" }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" className="viz-axis">{Math.round(t * 10) / 10}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = L + slot * i + slot / 2;
          return (
            <g key={d.month} className="viz-group">
              <rect x={L + slot * i} y={T} width={slot} height={H - T - B} fill="transparent" className="viz-hit">
                <title>{`${label(d.month)} ${d.month.slice(0, 4)}: ${d.direct} direkt, ${d.portal} über Portale${d.admin ? `, ${d.admin} manuell erfasst` : ""}`}</title>
              </rect>
              <path d={bar(cx - bw - 1, y(d.direct), bw, base - y(d.direct))} fill="var(--viz-direct)" pointerEvents="none" />
              <path d={bar(cx + 1, y(d.portal), bw, base - y(d.portal))} fill="var(--viz-portal)" pointerEvents="none" />
              <text x={cx} y={H - 8} textAnchor="middle" className="viz-axis">{label(d.month)}</text>
            </g>
          );
        })}
      </svg>
      <details className="small" style={{ marginTop: 8 }}>
        <summary className="muted">Als Tabelle</summary>
        <table className="table small">
          <thead><tr><th>Monat</th><th>Direkt</th><th>Portale</th><th>Manuell</th></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month}><td>{label(d.month)} {d.month.slice(0, 4)}</td><td>{d.direct}</td><td>{d.portal}</td><td>{d.admin}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
