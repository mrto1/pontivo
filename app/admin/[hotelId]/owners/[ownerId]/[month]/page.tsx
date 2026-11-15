import { notFound } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { OwnerError, ownerStatement } from "@/src/services/owners";
import { formatChf } from "@/src/domain/money";

export const dynamic = "force-dynamic";

/** Druckansicht der Abrechnung (im Browser «Drucken» → als PDF speichern) */
export default async function StatementPrint({ params }: { params: Promise<{ hotelId: string; ownerId: string; month: string }> }) {
  const { hotelId, ownerId, month } = await params;
  const { hotel } = await requireHotel(hotelId, "staff", "owners");
  await requireModule(hotel.id, "owners");
  let x;
  try { x = await ownerStatement(hotel.id, ownerId, month); } catch (e) { if (e instanceof OwnerError) notFound(); throw e; }
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <h1>Abrechnung {month}</h1>
      <p>{hotel.name}<br />für {x.owner.name}</p>
      <table className="table"><tbody>
        <tr><td>Umsatz Übernachtungen ({x.bookingsCount} Buchungen)</td><td style={{ textAlign: "right" }}>{formatChf(x.revenueRappen)}</td></tr>
        <tr><td>Kommission {(x.commissionBps / 100).toLocaleString("de-CH")} %</td><td style={{ textAlign: "right" }}>−{formatChf(x.commissionRappen)}</td></tr>
        {x.costs.map((c) => <tr key={c.id}><td>{c.description}</td><td style={{ textAlign: "right" }}>−{formatChf(c.amountRappen)}</td></tr>)}
        <tr><td><strong>Auszahlung</strong></td><td style={{ textAlign: "right" }}><strong>{formatChf(x.netRappen)}</strong></td></tr>
      </tbody></table>
      <p className="muted">Umsatz = Übernachtungspreise bestätigter Buchungen (Nächte im Monat), ohne Kurtaxe und Zusatzleistungen.</p>
    </div>
  );
}
