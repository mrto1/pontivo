import { formatChf } from "@/src/domain/money";
import type { monthlyReport } from "@/src/services/report";

const SOURCE: Record<string, string> = { direct: "Direkt (Website)", booking_com: "Booking.com", expedia: "Expedia", airbnb: "Airbnb", other_ota: "Andere Portale", admin: "Admin", total: "Total" };

export function ReportView({ r }: { r: Awaited<ReturnType<typeof monthlyReport>> }) {
  return (
    <>
      <table className="table">
        <thead>
          <tr><th>Quelle</th><th>Buchungen</th><th>Nächte</th><th>Umsatz</th><th>davon Kurtaxe</th><th>Erstattet</th><th>Plattformgebühr</th><th>Gebühr netto</th></tr>
        </thead>
        <tbody>
          {[...r.summary, r.total].map((s) => (
            <tr key={s.source} style={s.source === "total" ? { fontWeight: 700 } : undefined}>
              <td>{SOURCE[s.source] ?? s.source}</td><td>{s.bookings}</td><td>{s.nights}</td><td>{formatChf(s.revenue_rappen)}</td>
              <td>{formatChf(s.tourist_tax_rappen)}</td><td>{formatChf(s.refunded_rappen)}</td><td>{formatChf(s.fee_rappen)}</td><td>{formatChf(s.net_fee_rappen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="mt24">Buchungen</h3>
      <table className="table small">
        <thead><tr><th>Ref.</th><th>Bestätigt</th><th>Quelle</th><th>Status</th><th>Aufenthalt</th><th>Gast</th><th>Total</th><th>Erstattet</th><th>Gebühr netto</th></tr></thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.reference}</td><td>{l.confirmed_local}</td><td>{SOURCE[l.source] ?? l.source}</td><td>{l.status}</td>
              <td>{l.checkin} → {l.checkout}</td><td>{l.guest}</td><td>{formatChf(l.total_rappen)}</td><td>{formatChf(l.refunded_rappen)}</td><td>{formatChf(l.net_fee_rappen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.lines.length === 0 ? <p className="muted">Keine Buchungen in diesem Monat.</p> : null}
    </>
  );
}
