import { notFound } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { OwnerError, ownerStatement } from "@/src/services/owners";
import { formatChf } from "@/src/domain/money";

export const dynamic = "force-dynamic";

/** Druckansicht der Abrechnung (im Browser «Drucken» → als PDF speichern) */
export default async function StatementPrint({ params }: { params: Promise<{ hotelId: string; ownerId: string; month: string }> }) {
  const { hotelId, ownerId, month } = await params;
  const { hotel } = await requireHotelModule("owners", hotelId, "staff", "owners");
  let x;
  try { x = await ownerStatement(hotel.id, ownerId, month); } catch (e) { if (e instanceof OwnerError) notFound(); throw e; }
  return (
    <div className="stack u-maxw-640px">
      <h1>Abrechnung {month}</h1>
      <p>{hotel.name}<br />für {x.owner.name}</p>
      <table className="table"><tbody>
        <tr><td>Umsatz Übernachtungen ({x.bookingsCount} Buchungen)</td><td className="ta-r">{formatChf(x.revenueRappen)}</td></tr>
        <tr><td>Kommission {(x.commissionBps / 100).toLocaleString("de-CH")} %</td><td className="ta-r">−{formatChf(x.commissionRappen)}</td></tr>
        {x.costs.map((c) => <tr key={c.id}><td>{c.description}</td><td className="ta-r">−{formatChf(c.amountRappen)}</td></tr>)}
        <tr><td><strong>Auszahlung</strong></td><td className="ta-r"><strong>{formatChf(x.netRappen)}</strong></td></tr>
      </tbody></table>
      <p className="muted">Umsatz = Übernachtungspreise bestätigter Buchungen (Nächte im Monat), ohne Kurtaxe und Zusatzleistungen.</p>
    </div>
  );
}
