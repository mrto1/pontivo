import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { onlineSalesDays } from "@/src/services/online-sales";
import { salesTotal } from "@/src/domain/online-sales";
import { shiftMonth } from "@/src/services/overview";
import { monthEnd } from "@/src/domain/platform-invoice";
import { todayIn } from "@/src/domain/dates";
import { formatChf } from "@/src/domain/money";
import { formatBps } from "@/src/domain/invoice";
import { PeriodNav } from "@/components/admin/PeriodNav";
import { PrintButton } from "@/components/admin/PrintButton";

export const dynamic = "force-dynamic";
const fmt = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** Tagesabrechnung der Online-Verkäufe (SPEC 20.8): je Tag Total, MWST je Satz, online bezahlt / bar, Gebühr; Druck (PDF) und CSV. Ohne Modul Kasse. */
export default async function OnlineSales({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "staff", "onlinesales");
  await requireModule(hotel.id, "restaurant");
  const cur = todayIn(hotel.timezone).slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : cur;
  const from = `${month}-01`, to = monthEnd(month);
  const days = await onlineSalesDays(hotel, from, to);
  const sum = salesTotal(days);
  const base = `/admin/${hotel.id}/restaurant/online-verkaeufe`;
  const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("de-CH", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div className="stack print-page">
      <style>{`@media print{.no-print,.admin-head,.section-tabs{display:none !important} body{background:#fff;color:#000}}`}</style>
      <h1>Online-Verkäufe {label}</h1>
      <div className="no-print">
        <PeriodNav prev={`${base}?month=${shiftMonth(month, -1)}`} next={month < cur ? `${base}?month=${shiftMonth(month, 1)}` : undefined} todayHref={base} todayActive={month === cur} todayLabel="Dieser Monat" jump={{ kind: "month", value: month, param: "month" }}>
          <a className="btn secondary small" href={`${base}/csv?month=${month}`}>CSV</a>
          <PrintButton />
        </PeriodNav>
      </div>
      <p className="small muted">{hotel.legalName ?? hotel.name} · Bestellungen über Pontivo (Abholung und Lieferung), je Geschäftstag. Grundlage sind die unveränderbaren Bons des Geräts «ONL»; online bezahlte Beträge zahlt Stripe aus, Bargeld haben Sie bzw. Ihre Fahrer erhalten. Die Plattformgebühr ist bei Online-Zahlung schon abgezogen, bei Barzahlung kommt sie auf die Monatsrechnung.</p>
      {days.length ? (
        <div className="scroll-x"><table className="table" data-testid="online-sales">
          <thead><tr><th>Tag</th><th>Bestellungen</th><th>Total</th><th>MWST</th><th>Online bezahlt</th><th>Bar</th><th>Gebühr</th></tr></thead>
          <tbody>{days.map((d) => (
            <tr key={d.day}><td>{fmt(d.day)}</td><td>{d.count}</td><td>{formatChf(d.totalRappen)}</td>
              <td className="small">{d.vat.map((v) => <div key={v.bps}>{formatBps(v.bps)}: {formatChf(v.vatRappen)} <span className="muted">(netto {formatChf(v.netRappen)})</span></div>)}</td>
              <td>{formatChf(d.cardRappen)}</td><td>{formatChf(d.cashRappen)}</td><td>{formatChf(d.feeRappen)}</td></tr>
          ))}</tbody>
          <tfoot><tr><th>Total</th><th>{sum.count}</th><th>{formatChf(sum.totalRappen)}</th>
            <th className="small">{sum.vat.map((v) => <div key={v.bps}>{formatBps(v.bps)}: {formatChf(v.vatRappen)} <span className="muted">(netto {formatChf(v.netRappen)})</span></div>)}</th>
            <th>{formatChf(sum.cardRappen)}</th><th>{formatChf(sum.cashRappen)}</th><th>{formatChf(sum.feeRappen)}</th></tr></tfoot>
        </table></div>
      ) : <p className="muted">Keine Online-Verkäufe in diesem Monat.</p>}
      <p className="small muted no-print">Mit dem Modul Buchhaltung-Export stehen die Online-Verkäufe je Tag auch in der Buchungsliste (Beleg «ONL-Datum»). Zeitraum: {fmt(from)} bis {fmt(to)}.</p>
    </div>
  );
}
