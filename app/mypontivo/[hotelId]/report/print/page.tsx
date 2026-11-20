import { requireHotel } from "@/src/auth/guard";
import { isMonth, monthlyReport } from "@/src/services/report";
import { todayIn } from "@/src/domain/dates";
import { ReportView } from "@/components/admin/ReportView";
import { PrintButton } from "@/components/admin/PrintButton";

export const dynamic = "force-dynamic";

/** Druckansicht der Monatsabrechnung → im Browser „Als PDF speichern“ */
// ASSUMPTION: PDF über die Druckfunktion des Browsers statt serverseitiger PDF-Erzeugung (keine Zusatzabhängigkeit).
export default async function PrintReport({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  const month = isMonth(sp.month) ? sp.month : todayIn(hotel.timezone).slice(0, 7);
  const r = await monthlyReport(hotel.id, month);
  return (
    <div className="print-page">
      <style>{`.admin-head{display:none} @media print{.no-print{display:none} body{background:#fff;color:#000} .table th,.table td{font-size:9pt;padding:4px}}`}</style>
      <div className="no-print" style={{ margin: "16px 0" }}><PrintButton /></div>
      <h1>Monatsabrechnung {month}</h1>
      <p>{hotel.legalName ?? hotel.name}{hotel.addressLine ? `, ${hotel.addressLine}` : ""}{hotel.city ? `, ${hotel.postalCode ?? ""} ${hotel.city}` : ""}</p>
      <p className="small muted">Erstellt am {todayIn(hotel.timezone)}. Buchungen mit Bestätigung im Monat (Zeitzone {hotel.timezone}). Beträge in CHF.</p>
      <ReportView r={r} />
    </div>
  );
}
