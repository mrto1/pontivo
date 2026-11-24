import type { Hotel, Offer, OfferLine } from "@/src/db/schema";
import { formatChf } from "@/src/domain/money";
import { formatBps } from "@/src/domain/invoice";
import { lineTotal, offerNumber, offerTotals } from "@/src/domain/offers";
import { hhmm } from "@/src/domain/resources";
import { invoicingSettings } from "@/src/services/invoicing";

/** Angebot als A4-Blatt (Bildschirm und Druck, «Als PDF speichern» im Browser). Preise inkl. MWST. */
export function OfferSheet({ hotel, offer, lines, resourceNames = {} }: { hotel: Hotel; offer: Offer; lines: OfferLine[]; resourceNames?: Record<string, string> }) {
  const s = invoicingSettings(hotel);
  const tot = offerTotals(lines.map((l) => ({ description: l.description, quantity: l.quantity, unitRappen: l.unitRappen, vatKind: l.vatKind })), s);
  const d = (x: string) => x.split("-").reverse().join(".");
  const logo = hotel.content.brand?.logoUrl;
  return (
    <article className="card stack" style={{ maxWidth: 820 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>{logo ? <img src={logo} alt={hotel.name} style={{ maxHeight: 56 }} /> : <strong>{hotel.name}</strong>}<p className="small muted m0">{hotel.contactEmail}</p></div>
        <div className="ta-r"><strong>Angebot {offerNumber(offer.seq, String(offer.createdAt.getFullYear()))}</strong><p className="small muted m0">Gültig bis {d(offer.validUntil)}</p></div>
      </div>
      <p className="m0">{offer.company ? <>{offer.company}<br /></> : null}{offer.customerName}</p>
      <h2 className="m0">{offer.title}</h2>
      {offer.intro ? <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{offer.intro}</p> : null}
      <table className="table">
        <thead><tr><th>Position</th><th className="ta-r">Menge</th><th className="ta-r">Preis</th><th className="ta-r">Total</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>{l.description}{l.resourceId && l.day && l.startMin !== null && l.endMin !== null ? <span className="small muted"><br />{resourceNames[l.resourceId] ?? "Raum"}: {d(l.day)}, {hhmm(l.startMin)}–{l.endMin === 1440 ? "24:00" : hhmm(l.endMin)}, {l.persons} Personen</span> : null}</td>
              <td className="ta-r">{l.quantity}</td><td className="ta-r">{formatChf(l.unitRappen)}</td><td className="ta-r">{formatChf(lineTotal(l))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={3}><strong>Total inkl. MWST</strong></td><td className="ta-r"><strong>{formatChf(tot.totalRappen)}</strong></td></tr>
          {tot.rows.filter((r) => r.bps > 0).map((r) => <tr key={r.bps}><td colSpan={3} className="small muted">davon MWST {formatBps(r.bps)}</td><td className="small muted ta-r">{formatChf(r.vatRappen)}</td></tr>)}
        </tfoot>
      </table>
      {!s.vatLiable ? <p className="small muted m0">Nicht MWST-pflichtig, Preise ohne MWST-Ausweis.</p> : null}
    </article>
  );
}
