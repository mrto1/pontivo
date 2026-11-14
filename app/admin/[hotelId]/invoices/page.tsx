import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { requireModule } from "@/src/services/modules";
import { InvoiceError, invoicingSettings, listInvoices, updateInvoicingSettings } from "@/src/services/invoicing";
import { formatChf } from "@/src/domain/money";
import { formatDay } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const bps = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);

async function save(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "invoicing");
  let msg = "Einstellungen gespeichert.";
  try {
    await updateInvoicingSettings(c.hotel, {
      vatLiable: f.get("vatLiable") === "on", vatNumber: s(f, "vatNumber"), stayBps: bps(s(f, "stay") || "3.8"), standardBps: bps(s(f, "standard") || "8.1"),
      iban: s(f, "iban"), qrIban: s(f, "qrIban"), paymentDays: Number(s(f, "days")) || 0, footer: s(f, "footer"), autoSend: f.get("autoSend") === "on",
    }, c.actor);
  } catch (e) {
    if (!(e instanceof InvoiceError)) throw e;
    msg = `Nicht gespeichert: ${e.message}`;
  }
  redirect(`/admin/${c.hotel.id}/invoices?msg=${encodeURIComponent(msg)}`);
}

export default async function Invoices({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "staff", "invoices");
  await requireModule(hotel.id, "invoicing");
  const manager = atLeast(role, "manager");
  const set = invoicingSettings(hotel);
  const list = await listInvoices(hotel.id, sp.filter === "draft" ? "draft" : sp.filter === "issued" ? "issued" : "all");
  return (
    <div className="stack">
      <h1>Rechnungen</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      <p className="small">
        <a href={`/admin/${hotel.id}/invoices`}>Alle</a> · <a href={`?filter=draft`}>Entwürfe</a> · <a href={`?filter=issued`}>Ausgestellt</a> ·{" "}
        Neue Rechnung: auf der Buchung unter «Rechnung &amp; Kasse».
      </p>
      <section className="card stack">
        {list.length ? (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Nummer</th><th>Art</th><th>Datum</th><th>Empfänger</th><th>Buchung</th><th>Betrag</th><th>Status</th></tr></thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id}>
                  <td><a href={`/admin/${hotel.id}/invoices/${i.id}`}>{i.number ?? "Entwurf"}</a></td>
                  <td>{i.kind === "credit_note" ? "Gutschrift" : "Rechnung"}</td>
                  <td className="small">{i.issuedOn ? formatDay(i.issuedOn, "de") : i.createdAt.toLocaleDateString("de-CH", { timeZone: hotel.timezone })}</td>
                  <td>{i.recipient.company || i.recipient.name || "–"}</td>
                  <td>{i.bookingId ? <a href={`/admin/${hotel.id}/bookings/${i.bookingId}`}>{i.reference}</a> : "–"}</td>
                  <td>{formatChf(i.totalRappen)}</td>
                  <td>{i.status === "draft" ? <span className="badge warn">Entwurf</span> : <span className="badge">ausgestellt</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <p className="muted small">Noch keine Rechnungen.</p>}
      </section>

      <section className="card stack">
        <h2>Einstellungen Rechnung</h2>
        <p className="small muted">Ob Sie MWST-pflichtig sind, wissen Sie oder Ihr Treuhänder. Die Sätze unten sind Vorgaben (Sondersatz Beherbergung 3,8 %, Normalsatz 8,1 %, Stand 2026, befristet). Bitte vor dem ersten Einsatz mit Ihrem Treuhänder prüfen.</p>
        <form action={save} className="stack">
          <input type="hidden" name="hotelId" value={hotel.id} />
          <fieldset className="plain stack" disabled={!manager}>
            <label className="check"><input type="checkbox" name="vatLiable" defaultChecked={set.vatLiable} />Wir sind MWST-pflichtig (Rechnungen mit MWST)</label>
            <label className="check"><input type="checkbox" name="autoSend" defaultChecked={set.autoSend} />Rechnung beim Ausstellen automatisch per E-Mail senden (wenn eine Adresse bekannt ist)</label>
            <div className="form-grid">
              <div><label>MWST-Nummer</label><input name="vatNumber" defaultValue={set.vatNumber} placeholder="CHE-123.456.789 MWST" /></div>
              <div><label>Satz Beherbergung %</label><input name="stay" inputMode="decimal" defaultValue={(set.stayBps / 100).toString()} /></div>
              <div><label>Satz übrige Leistungen %</label><input name="standard" inputMode="decimal" defaultValue={(set.standardBps / 100).toString()} /></div>
              <div><label>IBAN (für die QR-Rechnung)</label><input name="iban" defaultValue={set.iban} placeholder="CH93 0076 2011 6238 5295 7" /></div>
              <div><label>QR-IBAN (optional)</label><input name="qrIban" defaultValue={set.qrIban} placeholder="CH44 3199 9123 0008 8901 2" /><p className="muted small">Nur wenn Ihre Bank Ihnen eine QR-IBAN gegeben hat. Dann trägt jede Rechnung eine QR-Referenz, und Zahlungen lassen sich automatisch zuordnen.</p></div>
              <div><label>Zahlungsfrist (Tage)</label><input name="days" type="number" min={0} max={120} defaultValue={set.paymentDays} /></div>
              <div><label>Fusszeile (optional)</label><input name="footer" defaultValue={set.footer} maxLength={500} placeholder="z. B. Danke für Ihren Besuch" /></div>
            </div>
          </fieldset>
          {manager ? <div><button className="btn small">Speichern</button></div> : null}
        </form>
      </section>
    </div>
  );
}
