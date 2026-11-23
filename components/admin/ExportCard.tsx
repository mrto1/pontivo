"use client";
import { useState } from "react";
import { DownloadLink } from "./DownloadLink";

export type ExportAction = { label: string; path: string; param: string | Partial<Record<Kind, string>>; extra?: Record<string, string>; target?: "_blank"; primary?: boolean };
export type Kind = "month" | "quarter" | "year" | "range";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
const shiftQuarter = (q: string, n: number) => { const [y, k] = q.split("-Q").map(Number); const i = y * 4 + (k - 1) + n; return `${Math.floor(i / 4)}-Q${(i % 4) + 1}`; };
const shiftYear = (y: string, n: number) => String(Number(y) + n);
const label = (kind: Kind, v: string) => (kind === "month" ? `${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}` : kind === "quarter" ? `Quartal ${v.slice(6)} / ${v.slice(0, 4)}` : v);

/**
 * Eine Export-Karte für «Berichte»: Titel, Satz, Zeitraum, Knöpfe. Alle Exporte sehen gleich aus.
 * Zeitraum: Monat, Quartal oder Jahr (je nach `kinds`, mit Umschalter) oder von–bis; ‹ › blättert, kein «Anzeigen»-Knopf.
 * Die Knöpfe sind normale Links (Download), der Zeitraum steckt im Parameter.
 */
export function ExportCard({ title, lead, kinds, initial, actions, children }: {
  title: string; lead: string; kinds: Kind[]; initial: { month: string; from: string; to: string }; actions: ExportAction[]; children?: React.ReactNode;
}) {
  const [kind, setKind] = useState<Kind>(kinds[0]);
  const [v, setV] = useState({ month: initial.month, quarter: `${initial.month.slice(0, 4)}-Q${Math.ceil(Number(initial.month.slice(5, 7)) / 3)}`, year: initial.month.slice(0, 4), from: initial.from, to: initial.to });
  const step = (n: number) => setV((x) => (kind === "month" ? { ...x, month: shiftMonth(x.month, n) } : kind === "quarter" ? { ...x, quarter: shiftQuarter(x.quarter, n) } : { ...x, year: shiftYear(x.year, n) }));
  const value = kind === "month" ? v.month : kind === "quarter" ? v.quarter : v.year;
  const KIND_LABEL: Record<Kind, string> = { month: "Monat", quarter: "Quartal", year: "Jahr", range: "Zeitraum" };
  const href = (a: ExportAction) => {
    const q = new URLSearchParams(a.extra);
    if (kind === "range") { q.set("from", v.from); q.set("to", v.to); } else q.set(typeof a.param === "string" ? a.param : a.param[kind] ?? "month", value);
    return `${a.path}?${q.toString()}`;
  };
  return (
    <section className="card export-card2" aria-label={title}>
      <h2>{title}</h2>
      <p className="muted small">{lead}</p>
      <div className="cal-tools">
        {kinds.length > 1 ? (
          <div className="seg" role="group" aria-label="Zeitraumart">
            {kinds.map((k) => <a key={k} href="#" className={k === kind ? "on" : undefined} onClick={(e) => { e.preventDefault(); setKind(k); }}>{KIND_LABEL[k]}</a>)}
          </div>
        ) : null}
        {kind === "range" ? (
          <>
            <input type="date" className="cal-date" aria-label="Von" value={v.from} onChange={(e) => e.target.value && setV({ ...v, from: e.target.value })} />
            <span className="muted">bis</span>
            <input type="date" className="cal-date" aria-label="Bis" value={v.to} onChange={(e) => e.target.value && setV({ ...v, to: e.target.value })} />
          </>
        ) : (
          <div className="seg" role="group" aria-label={KIND_LABEL[kind]}>
            <a href="#" aria-label="Zurück" onClick={(e) => { e.preventDefault(); step(-1); }}>‹</a>
            <span className="seg-mid">{label(kind, value)}</span>
            <a href="#" aria-label="Weiter" onClick={(e) => { e.preventDefault(); step(1); }}>›</a>
          </div>
        )}
      </div>
      {children}
      <div className="export-actions">
        {actions.map((a) => <DownloadLink key={a.label} primary={a.primary !== false && actions.indexOf(a) === 0} href={href(a)} target={a.target}>{a.label}</DownloadLink>)}
      </div>
    </section>
  );
}
