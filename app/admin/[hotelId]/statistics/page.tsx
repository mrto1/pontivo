import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { statistics } from "@/src/services/statistics";
import { PERIODS, PERIOD_LABEL, type Period } from "@/src/services/overview";
import { todayIn } from "@/src/domain/dates";
import { formatChf } from "@/src/domain/money";
import { SOURCE } from "@/components/admin/GuestTables";
import { atLeast } from "@/src/auth/session";
import { bpsOf } from "@/src/domain/money";
import { overview } from "@/src/services/overview";
import { DirectChart } from "@/components/admin/DirectChart";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const pct = (n: number) => `${n.toLocaleString("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

export default async function Statistik({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "staff", "statistics");
  // Gespartes und Gebühren nur für Inhaber und Geschäftsführung (wie die Abrechnung)
  const showSavings = atLeast(role, "manager");
  await requireModule(hotel.id, "statistics");
  const period: Period = (PERIODS as readonly string[]).includes(sp.period ?? "") ? (sp.period as Period) : "month";
  const s = await statistics(hotel.id, period, todayIn(hotel.timezone));
  const o = showSavings ? await overview(hotel, period) : null;
  const chf0 = (r: number) => formatChf(Math.round(r / 100) * 100).replace(/\.00$/, "");
  const Tile = ({ label, value, hint }: { label: string; value: string; hint: string }) => (
    <div className="card" style={{ flex: "1 1 150px" }}><div className="small muted">{label}</div><div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{value}</div><div className="small muted">{hint}</div></div>
  );
  return (
    <div className="stack">
      <h1 className="sr-only">Statistik</h1>
      <nav className="seg" aria-label="Zeitraum">
        {PERIODS.map((p) => <a key={p} href={`?period=${p}`} aria-current={p === period ? "true" : undefined}>{PERIOD_LABEL[p]}</a>)}
      </nav>
      {o ? (
        <>
          <section className="card hero-stat">
            <p className="muted small" style={{ margin: 0 }}>{PERIOD_LABEL[period]}: gespart gegenüber Buchungsportalen</p>
            <p className="hero-num">{chf0(o.savedRappen)}</p>
            {o.direct.bookings ? (
              <p className="muted small" style={{ margin: 0 }}>
                {o.direct.bookings} Direktbuchung{o.direct.bookings === 1 ? "" : "en"} · {o.direct.nights} Nächte · Zimmerumsatz {formatChf(o.direct.roomsRappen)}.
                {" "}Bei {(o.commissionBps / 100).toLocaleString("de-CH")} % Portal-Provision wären {formatChf(bpsOf(o.direct.roomsRappen, o.commissionBps))} angefallen, die Pontivo-Gebühr betrug {formatChf(o.direct.feeRappen)}.
                {" "}<a href={`/admin/${hotel.id}/channex#provision`}>Provision ändern</a>
              </p>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>Noch keine Direktbuchungen in diesem Zeitraum.</p>
            )}
          </section>
          <div className="tiles">
            <div className="card tile"><span className="muted small">Direktanteil</span><strong>{o.directSharePct === null ? "–" : `${o.directSharePct} %`}</strong><span className="muted small">der Online-Buchungen</span></div>
            <div className="card tile"><span className="muted small">Über Portale</span><strong>{o.portal.bookings}</strong><span className="muted small">Buchungen · {formatChf(o.portal.roomsRappen)}</span></div>
            <div className="card tile"><span className="muted small">Gutscheine verkauft</span><strong>{o.vouchers.sold}</strong><span className="muted small">{formatChf(o.vouchers.rappen)}</span></div>
            <div className="card tile"><span className="muted small">Anfragen</span><strong>{o.inquiries}</strong><span className="muted small"><a href={`/admin/${hotel.id}/inbox?quelle=web`}>ansehen</a></span></div>
          </div>
          <section className="card"><h2 style={{ fontSize: "1.15rem" }}>Buchungen pro Monat</h2><DirectChart data={o.chart} /></section>
        </>
      ) : null}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Tile label="Belegung" value={pct(s.total.occupancyPct)} hint={`${s.total.sold} von ${s.total.available} Zimmernächten`} />
        <Tile label="Ø Preis pro Nacht (ADR)" value={`${formatChf(s.total.adrRappen)}`} hint="Zimmerumsatz / verkaufte Nächte" />
        <Tile label="RevPAR" value={`${formatChf(s.total.revparRappen)}`} hint="Zimmerumsatz / verfügbare Nächte" />
        <Tile label="Zimmerumsatz" value={`${formatChf(s.total.revenueRappen)}`} hint="ohne Kurtaxe und Extras" />
      </div>
      {s.byMonth.length > 1 ? (
        <section className="card"><h2>Nach Monat</h2>
          <div className="scroll-x"><table className="table"><thead><tr><th>Monat</th><th>Belegung</th><th>Verkaufte Nächte</th><th>ADR</th><th>RevPAR</th><th>Umsatz</th></tr></thead>
            <tbody>{s.byMonth.map((m) => <tr key={m.month}><td>{monthLabel(m.month)}</td><td>{pct(m.occupancyPct)}</td><td>{m.sold}</td><td>{formatChf(m.adrRappen)}</td><td>{formatChf(m.revparRappen)}</td><td>{formatChf(m.revenueRappen)}</td></tr>)}</tbody></table></div>
        </section>
      ) : null}
      <section className="card"><h2>Herkunft der Buchungen</h2>
        {s.bySource.length ? (
          <div className="scroll-x"><table className="table"><thead><tr><th>Kanal</th><th>Verkaufte Nächte</th><th>Anteil</th><th>Umsatz</th></tr></thead>
            <tbody>{s.bySource.map((x) => <tr key={x.source}><td>{SOURCE[x.source] ?? x.source}</td><td>{x.sold}</td><td>{pct(x.sharePct)}</td><td>{formatChf(x.revenueRappen)}</td></tr>)}</tbody></table></div>
        ) : <p className="muted small">Keine Buchungen im Zeitraum.</p>}
      </section>
      <section className="card"><h2>Nach Zimmertyp</h2>
        <div className="scroll-x"><table className="table"><thead><tr><th>Typ</th><th>Belegung</th><th>Verkaufte Nächte</th><th>ADR</th><th>RevPAR</th><th>Umsatz</th></tr></thead>
          <tbody>{s.byType.map((t) => <tr key={t.id}><td>{t.name}</td><td>{pct(t.occupancyPct)}</td><td>{t.sold}</td><td>{formatChf(t.adrRappen)}</td><td>{formatChf(t.revparRappen)}</td><td>{formatChf(t.revenueRappen)}</td></tr>)}</tbody></table></div>
      </section>
      <p className="small muted">Nur bestätigte Buchungen, ganze Monate (auch künftige Tage des laufenden Monats). Verfügbar = Anzahl Zimmer je aktivem Zimmertyp × Tage; gesperrte Tage werden nicht abgezogen.</p>
    </div>
  );
}
