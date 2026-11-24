import { bookingBalance, invoicesOfBooking, listFolio, listOnsitePayments } from "@/src/services/invoicing";
import { db } from "@/src/db/client";
import { formatChf } from "@/src/domain/money";
import { todayIn } from "@/src/domain/dates";
import type { Hotel } from "@/src/db/schema";
import { moduleOn } from "@/src/services/modules";
import { TerminalCard } from "./TerminalCard";
import { listGoods } from "@/src/services/goods";
import { addFolioAction, addGoodAction, deleteFolioAction, draftAction, onsitePaymentAction } from "./cash-actions";

const METHOD: Record<string, string> = { cash: "bar", card: "Karte", twint: "TWINT", bank: "Überweisung", other: "andere" };

/** Rechnung & Kasse auf der Buchung (Modul «Rechnung & Kasse», SPEC 16.3) */
export async function CashCard({ hotel, bookingId, status }: { hotel: Hotel; bookingId: string; status: string }) {
  const bal = await bookingBalance(db(), hotel.id, bookingId);
  const folio = await listFolio(hotel.id, bookingId);
  const pays = await listOnsitePayments(hotel.id, bookingId);
  const invs = await invoicesOfBooking(hotel.id, bookingId);
  const goodsList = (await moduleOn(hotel.id, "shop")) ? await listGoods(hotel.id, { onlySellable: true }) : [];
  const hid = (<><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="bookingId" value={bookingId} /></>);
  const open = bal.openRappen;
  return (
    <div className="card stack" id="kasse">
      <h3>Rechnung &amp; Kasse</h3>
      <p>
        Gesamt {formatChf(bal.totalRappen)}{bal.voucherRappen ? `, Gutschein −${formatChf(bal.voucherRappen)}` : ""} · bezahlt {formatChf(bal.paidRappen)} · <strong>{open > 0 ? `offen ${formatChf(open)}` : open < 0 ? `Guthaben ${formatChf(-open)}` : "alles bezahlt"}</strong>
      </p>

      <h4>Posten (z. B. Minibar, Restaurant)</h4>
      {folio.length ? (
        <table className="table"><tbody>
          {folio.map((f) => (
            <tr key={f.id}>
              <td>{f.description}</td><td>{f.quantity} × {formatChf(f.unitPriceRappen)}</td><td>{formatChf(f.quantity * f.unitPriceRappen)}</td>
              <td className="small muted">{f.invoiceId ? "auf Rechnung" : "offen"}</td>
              <td>{f.invoiceId ? null : <form action={deleteFolioAction}>{hid}<input type="hidden" name="itemId" value={f.id} /><button className="btn secondary small">Löschen</button></form>}</td>
            </tr>
          ))}
        </tbody></table>
      ) : <p className="muted small">Keine Posten.</p>}
      {goodsList.length ? (
        <form action={addGoodAction} className="inline-form">
          {hid}
          <div style={{ minWidth: 200 }}><label htmlFor="f14271">Ware aus dem Shop</label><select id="f14271" name="goodId" required>{goodsList.map((x) => <option key={x.id} value={x.id}>{x.name} · {formatChf(x.priceRappen)}</option>)}</select></div>
          <div><label htmlFor="f14272">Menge</label><input id="f14272" name="quantity" type="number" min={1} defaultValue={1} className="w70" /></div>
          <button className="btn secondary small">Ware buchen</button>
        </form>
      ) : null}
      <form action={addFolioAction} className="inline-form">
        {hid}
        <div style={{ minWidth: 200 }}><label htmlFor="f14273">Beschreibung</label><input id="f14273" name="description" required maxLength={200} placeholder="z. B. Abendessen" /></div>
        <div><label htmlFor="f14274">Menge</label><input id="f14274" name="quantity" type="number" defaultValue={1} className="w70" /></div>
        <div><label htmlFor="f14275">Preis CHF (Rabatt: negativ)</label><input className="w110" id="f14275" name="price" required inputMode="decimal" /></div>
        <div><label htmlFor="f14276">MWST</label><select id="f14276" name="vatKind" defaultValue="standard"><option value="standard">übrige Leistungen</option><option value="stay">Beherbergung</option><option value="none">ohne MWST</option></select></div>
        <button className="btn secondary small">Posten hinzufügen</button>
      </form>

      <h4>Zahlungen vor Ort</h4>
      {pays.length ? (
        <table className="table"><tbody>
          {pays.map((p) => <tr key={p.id}><td className="small">{p.receivedOn}</td><td>{METHOD[p.method]}</td><td>{formatChf(p.amountRappen)}</td><td className="small muted">{p.note}</td></tr>)}
        </tbody></table>
      ) : <p className="muted small">Keine Zahlungen vor Ort erfasst.</p>}
      <form action={onsitePaymentAction} className="inline-form">
        {hid}
        <div><label htmlFor="f14277">Betrag CHF (Rückzahlung: negativ)</label><input id="f14277" name="amount" required inputMode="decimal" defaultValue={open > 0 ? (open / 100).toFixed(2) : ""} style={{ width: 130 }} /></div>
        <div><label htmlFor="f14278">Art</label><select id="f14278" name="method"><option value="cash">bar</option><option value="card">Karte</option><option value="twint">TWINT</option><option value="bank">Überweisung</option><option value="other">andere</option></select></div>
        <div><label htmlFor="f14279">Datum</label><input id="f14279" name="date" type="date" defaultValue={todayIn(hotel.timezone)} /></div>
        <div style={{ minWidth: 160 }}><label htmlFor="f142710">Notiz</label><input id="f142710" name="note" maxLength={200} /></div>
        <button className="btn secondary small">Zahlung verbuchen</button>
      </form>

      {(await moduleOn(hotel.id, "terminal")) ? <TerminalCard hotel={hotel} bookingId={bookingId} /> : null}

      <h4>Rechnungen</h4>
      {invs.length ? (
        <table className="table"><tbody>
          {invs.map((i) => (
            <tr key={i.id}>
              <td><a href={`/admin/${hotel.id}/invoices/${i.id}`}>{i.number ?? "Entwurf"}</a></td>
              <td>{i.kind === "credit_note" ? "Gutschrift" : "Rechnung"}</td><td>{formatChf(i.totalRappen)}</td>
              <td className="small muted">{i.status === "draft" ? "Entwurf" : i.issuedOn}</td>
            </tr>
          ))}
        </tbody></table>
      ) : <p className="muted small">Noch keine Rechnung.</p>}
      {status === "confirmed" ? <form action={draftAction}>{hid}<button className="btn small">Rechnung erstellen / Entwurf öffnen</button></form> : null}
    </div>
  );
}
