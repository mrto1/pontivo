import { notFound } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { isDay, todayIn } from "@/src/domain/dates";
import { countryName } from "@/src/domain/countries";
import { docLabel, logRegisterExport, registerRows, registrationSignature } from "@/src/services/guests";
import { PrintButton } from "@/components/admin/PrintButton";

export const dynamic = "force-dynamic";

/** Gästeregister zum Drucken / als PDF (Browser). Aufruf wird als Export protokolliert. */
export default async function PrintRegister({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, actor } = await requireHotel(hotelId, "staff");
  if (!isDay(sp.from ?? "") || !isDay(sp.to ?? "") || sp.from! > sp.to!) notFound();
  const list = await registerRows(hotel.id, sp.from!, sp.to!);
  await logRegisterExport(hotel.id, sp.from!, sp.to!, "pdf", list.length, actor);
  const sigs = new Map<string, string | null>();
  for (const r of list) if (r.hasSignature) sigs.set(r.id, await registrationSignature(hotel.id, r.id));
  return (
    <div className="print-page">
      <style>{`.admin-head{display:none} @media print{.no-print{display:none} body{background:#fff;color:#000} .table th,.table td{font-size:8pt;padding:3px}} .sig{height:36px}`}</style>
      <div className="no-print" style={{ margin: "16px 0" }}><PrintButton /></div>
      <h1>Gästeregister {sp.from} bis {sp.to}</h1>
      <p>{hotel.legalName ?? hotel.name}{hotel.addressLine ? `, ${hotel.addressLine}` : ""}{hotel.city ? `, ${hotel.postalCode ?? ""} ${hotel.city}` : ""} · Kanton {hotel.canton}</p>
      <p className="small muted">Erstellt am {todayIn(hotel.timezone)}, {list.length} Einträge. Vertraulich: nur zur Herausgabe an die Polizei auf Verlangen.</p>
      <table className="table">
        <thead><tr><th>Buchung</th><th>Anreise</th><th>Abreise</th><th>Name</th><th>Geb.</th><th>Nat.</th><th>Adresse</th><th>Ausweis</th><th>Kennz.</th><th>Unterschrift</th><th>Ausweis gesehen</th></tr></thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td>{r.reference}{r.listOnly ? <div className="small muted">Teilnehmerliste</div> : null}</td>
              <td>{r.arrivalDate}</td><td>{r.departureDate}</td>
              <td><strong>{r.lastName}</strong> {r.firstName}{r.sex ? ` (${r.sex})` : ""}</td>
              <td>{r.birthDate}</td><td>{r.nationality}</td>
              <td>{r.street ? `${r.street}, ${r.postalCode ?? ""} ${r.city ?? ""}, ${countryName(r.country)}` : ""}</td>
              <td>{r.idDocumentNumber ? `${docLabel(r.idDocumentType)} ${r.idDocumentNumber}` : ""}</td>
              <td>{r.vehiclePlate ?? ""}</td>
              <td>{sigs.get(r.id) ? <img className="sig" src={sigs.get(r.id)!} alt="Unterschrift" /> : ""}</td>
              <td>{r.verifiedByStaffAt ? r.verifiedByStaffAt.toISOString().slice(0, 10) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
