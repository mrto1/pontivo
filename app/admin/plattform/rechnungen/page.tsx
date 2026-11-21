import { requirePlatformAdmin } from "@/src/auth/guard";
import { listOpenQrInvoices, listPlatformInvoices } from "@/src/services/billing";
import { getPlatformBilling } from "@/src/services/platform-settings";
import { formatChf } from "@/src/domain/money";
import { todayIn } from "@/src/domain/dates";
import { chargeStatusText } from "@/src/domain/platform-invoice";
import { camtImport, invoicePaid, invoiceRemind, invoiceResend, retryInvoice } from "../actions";
import { Flash, PageHead } from "../Flash";

export const dynamic = "force-dynamic";
const TO = "/admin/plattform/rechnungen";

export default async function Rechnungen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const today = todayIn("Europe/Zurich");
  const [invoices, open, billing] = await Promise.all([listPlatformInvoices(), listOpenQrInvoices(), getPlatformBilling()]);
  const To = <input type="hidden" name="to" value={TO} />;
  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHead title="Rechnungen an die Betriebe">Der Worker erstellt sie am 1. des Monats für den Vormonat. Weg Karte: Belastung der hinterlegten Karte, Fehlversuche lassen sich hier wiederholen. Weg QR-Rechnung: Mail mit Zahlteil, Erinnerung und Mahnungen 5, 20 und 35 Tage nach Fälligkeit.</PageHead>
      <Flash sp={sp} />
      {!billing.iban && open.length ? <p className="notice warn">Keine Zahlungsverbindung hinterlegt: Die QR-Rechnungen haben keinen Zahlteil. <a href="/admin/plattform/zahlungsverbindung">Jetzt erfassen</a></p> : null}

      <section className="card stack" data-testid="open-qr">
        <h2>Offene QR-Rechnungen</h2>
        {open.length ? (
          <div className="scroll-x"><table className="table small">
            <thead><tr><th>Nr.</th><th>Betrieb</th><th>Betrag</th><th>Status</th><th>Zahlung erfassen</th><th></th></tr></thead>
            <tbody>{open.map(({ c, hotelName }) => {
              const st = chargeStatusText(c, today);
              return (
                <tr key={c.id}>
                  <td><a href={`/mypontivo/${c.hotelId}/plattform-rechnung/${c.id}`} target="_blank">{c.invoiceNo}</a></td>
                  <td>{hotelName}</td><td>{formatChf(c.chargeRappen)}</td>
                  <td>{st.warn ? <span className="badge warn">{st.text}</span> : st.text}</td>
                  <td><form action={invoicePaid} className="inline-form">{To}<input type="hidden" name="id" value={c.id} />
                    <input type="date" name="paidOn" defaultValue={today} aria-label={`Zahlungsdatum ${c.invoiceNo}`} style={{ width: 140 }} />
                    <input name="note" placeholder="Notiz" maxLength={200} aria-label={`Notiz ${c.invoiceNo}`} style={{ width: 120 }} />
                    <button className="btn small">Bezahlt</button></form></td>
                  <td className="inline-form">
                    {c.dunningLevel < 3 ? <form action={invoiceRemind}>{To}<input type="hidden" name="id" value={c.id} /><button className="btn secondary small">Mahnung senden</button></form> : null}
                    <form action={invoiceResend}>{To}<input type="hidden" name="id" value={c.id} /><button className="btn secondary small">Erneut senden</button></form>
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <p className="muted small">Keine offenen QR-Rechnungen.</p>}
        <form action={camtImport} className="inline-form">{To}
          <div><label htmlFor="camt">Bankdatei camt.054 (Gutschriften mit QR-Referenz werden zugeordnet)</label><input id="camt" name="file" type="file" accept=".xml,application/xml,text/xml" required /></div>
          <div><button className="btn secondary">Einlesen</button></div>
        </form>
      </section>

      <section className="card stack">
        <h2>Alle Rechnungen</h2>
        {invoices.length === 0 ? <p className="muted small">Noch keine.</p> : (
          <div className="scroll-x"><table className="table small">
            <thead><tr><th>Nr.</th><th>Betrieb</th><th>Monat</th><th>Weg</th><th>Netto</th><th>MWST</th><th>Betrag</th><th>Status</th><th></th></tr></thead>
            <tbody>{invoices.map(({ c, hotelName }) => {
              const st = chargeStatusText(c, today);
              return (
                <tr key={c.id}>
                  <td>{c.invoiceNo ? <a href={`/mypontivo/${c.hotelId}/plattform-rechnung/${c.id}`} target="_blank">{c.invoiceNo}</a> : "–"}</td>
                  <td>{hotelName}</td><td>{c.month}</td><td>{c.method === "qr" ? "QR" : "Karte"}</td><td>{formatChf(c.netRappen)}</td><td>{c.vatRappen ? formatChf(c.vatRappen) : "–"}</td><td>{formatChf(c.chargeRappen)}</td>
                  <td>{st.warn ? <span className="badge warn">{st.text}</span> : st.text}</td>
                  <td>{c.status === "failed" ? <form action={retryInvoice}>{To}<input type="hidden" name="id" value={c.id} /><button className="btn secondary">Erneut versuchen</button></form> : null}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
