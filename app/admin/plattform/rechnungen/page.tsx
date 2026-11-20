import { requirePlatformAdmin } from "@/src/auth/guard";
import { listPlatformInvoices } from "@/src/services/billing";
import { formatChf } from "@/src/domain/money";
import { retryInvoice } from "../actions";
import { Flash, PageHead } from "../Flash";

export const dynamic = "force-dynamic";
const TO = "/admin/plattform/rechnungen";

export default async function Rechnungen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const invoices = await listPlatformInvoices();
  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHead title="Rechnungen an die Betriebe">Der Worker erstellt sie am 1. des Monats für den Vormonat und belastet die hinterlegte Karte. Fehlgeschlagene Belastungen können hier nochmals versucht werden.</PageHead>
      <Flash sp={sp} />
      {invoices.length === 0 ? <p className="muted small">Noch keine.</p> : (
        <table className="table small">
          <thead><tr><th>Nr.</th><th>Betrieb</th><th>Monat</th><th>Netto</th><th>MWST</th><th>Belastet</th><th>Status</th><th></th></tr></thead>
          <tbody>{invoices.map(({ c, hotelName }) => (
            <tr key={c.id}>
              <td>{c.invoiceNo ? <a href={`/mypontivo/${c.hotelId}/plattform-rechnung/${c.id}`} target="_blank">{c.invoiceNo}</a> : "–"}</td>
              <td>{hotelName}</td><td>{c.month}</td><td>{formatChf(c.netRappen)}</td><td>{c.vatRappen ? formatChf(c.vatRappen) : "–"}</td><td>{formatChf(c.chargeRappen)}</td>
              <td>{c.status === "succeeded" ? "bezahlt" : c.status === "none" ? "nichts fällig" : c.status === "pending" ? "offen" : <span className="badge warn">fehlgeschlagen ({c.attempts}×)</span>}</td>
              <td>{c.status === "failed" ? <form action={retryInvoice}><input type="hidden" name="to" value={TO} /><input type="hidden" name="id" value={c.id} /><button className="btn secondary">Erneut versuchen</button></form> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
