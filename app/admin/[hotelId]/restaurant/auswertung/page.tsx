import { requireHotelModule } from "@/src/auth/guard";
import { diningStats } from "@/src/services/dining-stats";
import { shiftMonth } from "@/src/services/overview";
import { monthEnd } from "@/src/domain/platform-invoice";
import { todayIn } from "@/src/domain/dates";
import { formatChf } from "@/src/domain/money";
import { PeriodNav } from "@/components/admin/PeriodNav";
import type { Row } from "@/src/domain/dining-stats";

export const dynamic = "force-dynamic";
const stay = (m: number | null) => (m === null ? "–" : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

function Table({ title, rows, testid }: { title: string; rows: Row[]; testid: string }) {
  return (
    <section className="card stack" data-testid={testid}>
      <h2>{title}</h2>
      {rows.length ? (
        <div className="scroll-x"><table className="table">
          <thead><tr><th>Name</th><th className="num">Umsatz</th><th className="num">Trinkgeld</th><th className="num">Bons</th><th className="num">Ø Verweildauer</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id || "none"}><td>{r.name}</td><td className="num">{formatChf(r.revenueRappen)}</td><td className="num">{formatChf(r.tipRappen)}</td><td className="num">{r.receipts}</td><td className="num">{stay(r.avgStayMin)}</td></tr>)}</tbody>
        </table></div>
      ) : <p className="muted">Keine Bons im Zeitraum.</p>}
    </section>
  );
}

/** Auswertung Restaurant (SPEC 19.56): Umsatz und Trinkgeld je Tisch und Kellner, Verweildauer, Gäste je Stunde, No-shows, Bewertungen */
export default async function DiningStatsPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("restaurant", hotelId, "manager", "diningstats");
  const cur = todayIn(hotel.timezone).slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : cur;
  const s = await diningStats(hotel.id, `${month}-01`, monthEnd(month));
  const base = `/admin/${hotel.id}/restaurant/auswertung`;
  const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("de-CH", { month: "long", year: "numeric", timeZone: "UTC" });
  const maxG = Math.max(1, ...s.guestsByHour.map((h) => h.guests));
  return (
    <div className="stack">
      <h1>Auswertung {label}</h1>
      <PeriodNav prev={`${base}?month=${shiftMonth(month, -1)}`} next={month < cur ? `${base}?month=${shiftMonth(month, 1)}` : undefined} todayHref={base} todayActive={month === cur} todayLabel="Dieser Monat" jump={{ kind: "month", value: month, param: "month" }}>{null}</PeriodNav>
      <p className="small muted">Grundlage sind die Bons der Kasse. Kellner und Tische gelten nach der heutigen Zuweisung; Bestellungen, die länger als 8 Stunden offen waren, zählen nicht zur Verweildauer.</p>
      <div className="stat-row" data-testid="dining-totals">
        <div className="card"><div className="small muted">Umsatz</div><strong>{formatChf(s.totalRappen)}</strong></div>
        <div className="card"><div className="small muted">Trinkgeld</div><strong>{formatChf(s.tipRappen)}</strong></div>
        <div className="card"><div className="small muted">Ø Verweildauer</div><strong>{stay(s.avgStayMin)}</strong></div>
        <div className="card"><div className="small muted">No-show-Quote</div><strong>{s.reservations.noShowPct} %</strong><div className="small muted">{s.reservations.noShow} von {s.reservations.total}</div></div>
        <div className="card"><div className="small muted">Bewertung</div><strong>{s.feedback.avgStars ?? "–"}{s.feedback.avgStars ? " ★" : ""}</strong><div className="small muted">{s.feedback.count} Rückmeldungen</div></div>
      </div>
      <Table title="Je Kellner" rows={s.waiters} testid="stats-waiters" />
      <Table title="Je Tisch" rows={s.tables} testid="stats-tables" />
      <section className="card stack">
        <h2>Gäste nach Uhrzeit (Reservierungen)</h2>
        {s.guestsByHour.length ? s.guestsByHour.map((h) => (
          <div key={h.hour} className="bar-row"><span className="small">{String(h.hour).padStart(2, "0")}:00</span><div className="bar" style={{ width: `${(h.guests / maxG) * 100}%` }} /><span className="small">{h.guests}</span></div>
        )) : <p className="muted">Keine Reservierungen im Zeitraum.</p>}
      </section>
      {s.feedback.low.length ? (
        <section className="card stack"><h2>Kritische Rückmeldungen</h2>
          {s.feedback.low.map((f, i) => <p key={i} className="m0"><strong>{"★".repeat(f.stars)}</strong> {f.comment}</p>)}
        </section>
      ) : null}
    </div>
  );
}
