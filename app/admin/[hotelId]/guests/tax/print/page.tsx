import { requireHotel } from "@/src/auth/guard";
import { todayIn } from "@/src/domain/dates";
import { isMonth } from "@/src/services/report";
import { touristTaxList } from "@/src/services/guests";
import { PrintButton } from "@/components/admin/PrintButton";
import { TaxTable } from "@/components/admin/GuestTables";

export const dynamic = "force-dynamic";

export default async function PrintTax({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  const month = isMonth(sp.month) ? sp.month : todayIn(hotel.timezone).slice(0, 7);
  const r = await touristTaxList(hotel, month);
  return (
    <div className="print-page">
      <style>{`.admin-head{display:none} @media print{.no-print{display:none} body{background:#fff;color:#000} .table th,.table td{font-size:9pt;padding:4px}}`}</style>
      <div className="no-print" style={{ margin: "16px 0" }}><PrintButton /></div>
      <h1>Kurtaxe-Liste {month}</h1>
      <p>{hotel.legalName ?? hotel.name}{hotel.municipality ? `, Gemeinde ${hotel.municipality}` : ""}, Kanton {hotel.canton}</p>
      <p className="small muted">Erstellt am {todayIn(hotel.timezone)}.</p>
      <TaxTable r={r} />
    </div>
  );
}
