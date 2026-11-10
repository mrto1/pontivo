import { formatChf } from "@/src/domain/money";
import type { touristTaxList } from "@/src/services/guests";

export const SOURCE: Record<string, string> = { direct: "Direkt", booking_com: "Booking.com", expedia: "Expedia", airbnb: "Airbnb", other_ota: "Portal", admin: "Manuell" };

export function TaxTable({ r }: { r: Awaited<ReturnType<typeof touristTaxList>> }) {
  return (
    <>
      <table className="table">
        <thead><tr><th>Buchung</th><th>Gast</th><th>Aufenthalt</th><th>Nächte im Monat</th><th>pflichtig</th><th>befreit</th><th>Logiernächte</th><th>Kurtaxe</th><th>Grundlage</th></tr></thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.bookingId}>
              <td>{l.reference}<div className="small muted">{SOURCE[l.source] ?? l.source}</div></td>
              <td>{l.guest}</td><td>{l.checkin} – {l.checkout}</td><td>{l.nightsInMonth}</td><td>{l.liable}</td><td>{l.exempt}</td><td>{l.personNights}</td>
              <td>{formatChf(l.amountRappen)}</td>
              <td className="small">{l.fromRegister ? "Meldeschein" : <>Buchung{l.unknownAge ? <span className="muted"> · {l.unknownAge} Kind/er Alter unbekannt</span> : null}</>}</td>
            </tr>
          ))}
          <tr><td colSpan={3}><strong>Total</strong></td><td>{r.total.nights}</td><td>{r.total.liable}</td><td>{r.total.exempt}</td><td><strong>{r.total.personNights}</strong></td><td><strong>{formatChf(r.total.amountRappen)}</strong></td><td></td></tr>
        </tbody>
      </table>
      <p className="small muted">Alle bestätigten Aufenthalte mit Übernachtungen im Monat, auch über Portale. Alter und Pflicht nach Meldeschein, sonst nach Buchung. Satz gemäss Kurtaxe-Regel am Anreisetag.</p>
    </>
  );
}
