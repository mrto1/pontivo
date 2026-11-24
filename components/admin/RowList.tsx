import Link from "next/link";

export type Row = { id: string; href: string; title: string; detail?: string; label: string; badges?: { text: string }[] };

/** Liste der Stammdaten: je Eintrag eine Zeile mit Titel, grauer Zeile darunter und Pfeil; ein Tipp öffnet die Seitenleiste */
export function RowList({ rows }: { rows: Row[] }) {
  return (
    <ul className="plan-list">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={r.href} scroll={false} className="plan-row" aria-label={r.label}>
            <span><strong>{r.title}</strong>{r.detail ? <><br /><span className="muted small">{r.detail}</span></> : null}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>{r.badges?.map((b) => <span key={b.text} className="badge warn">{b.text}</span>)}<span className="rt-arrow" aria-hidden="true">›</span></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
