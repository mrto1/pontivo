import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { InvoiceError } from "@/src/services/invoicing";
import {
  DebtorError, agingTotals, importBankFile, listCompanies, listOpenInvoices, recordInvoicePayment, saveCompany, sendDunning,
} from "@/src/services/debtors";
import { BUCKET_LABEL, DUNNING_LABEL, type Bucket } from "@/src/domain/debtors";
import { decimalToRappen, formatChf } from "@/src/domain/money";
import { formatDay } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const BUCKETS: Bucket[] = ["not_due", "d1_30", "d31_60", "d60_plus"];

async function guard(f: FormData) {
  const c = await requireHotel(s(f, "hotelId"), "staff", "debtors");
  await requireModule(c.hotel.id, "invoicing");
  await requireModule(c.hotel.id, "debtors");
  return c;
}
async function run(f: FormData, fn: (c: Awaited<ReturnType<typeof guard>>) => Promise<string>) {
  const c = await guard(f);
  let msg: string;
  try { msg = await fn(c); } catch (e) {
    if (!(e instanceof DebtorError) && !(e instanceof InvoiceError)) throw e;
    msg = `Nicht möglich: ${e.message}`;
  }
  redirect(`/mypontivo/${c.hotel.id}/invoices/debitoren?msg=${encodeURIComponent(msg)}`);
}

async function pay(f: FormData) {
  "use server";
  await run(f, async (c) => {
    const amount = decimalToRappen(s(f, "amount").replace(",", ".").replace(/'/g, ""));
    await recordInvoicePayment(c.hotel, s(f, "invoiceId"), { amountRappen: amount, receivedOn: s(f, "date") || undefined, note: s(f, "note") }, c.actor);
    return "Zahlungseingang verbucht.";
  });
}
async function dun(f: FormData) {
  "use server";
  await run(f, async (c) => { const l = await sendDunning(c.hotel, s(f, "invoiceId"), c.actor); return `${DUNNING_LABEL[l]} wird gesendet.`; });
}
async function importFile(f: FormData) {
  "use server";
  await run(f, async (c) => {
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) throw new DebtorError("Bitte eine Datei wählen.");
    if (file.size > 5_000_000) throw new DebtorError("Die Datei ist zu gross (höchstens 5 MB).");
    const r = await importBankFile(c.hotel, await file.text(), c.actor);
    return `${r.matched.length} Zahlungen verbucht${r.duplicates ? `, ${r.duplicates} schon bekannt` : ""}${r.unmatched.length ? `, ${r.unmatched.length} ohne passende Rechnung` : ""}.`;
  });
}
async function company(f: FormData) {
  "use server";
  await run(f, async (c) => {
    const days = s(f, "days");
    await saveCompany(c.hotel.id, s(f, "id") || null, { name: s(f, "name"), street: s(f, "street"), zip: s(f, "zip"), city: s(f, "city"), country: s(f, "country"), vatId: s(f, "vatId"), email: s(f, "email"), paymentDays: days === "" ? null : Number(days), note: s(f, "note"), active: f.get("active") === "on" }, c.actor);
    return "Firma gespeichert.";
  });
}

export default async function Debtors({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "staff", "debtors");
  await requireModule(hotel.id, "invoicing");
  await requireModule(hotel.id, "debtors");
  const [open, firms] = await Promise.all([listOpenInvoices(hotel), listCompanies(hotel.id)]);
  const aging = agingTotals(open);
  const hid = <input type="hidden" name="hotelId" value={hotel.id} />;
  return (
    <div className="stack">
      <h1>Debitoren</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}

      <section className="card stack">
        <h2>Offene Rechnungen: {formatChf(open.reduce((a, i) => a + i.openRappen, 0))}</h2>
        <div className="inline-form">{BUCKETS.map((b) => <div key={b}><span className="muted small">{BUCKET_LABEL[b]}</span><br /><strong>{formatChf(aging[b])}</strong></div>)}</div>
        {open.length ? (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Rechnung</th><th>Zahler</th><th>Fällig</th><th>Offen</th><th>Mahnung</th><th>Zahlungseingang</th></tr></thead>
            <tbody>
              {open.map((i) => (
                <tr key={i.id}>
                  <td><a href={`/mypontivo/${hotel.id}/invoices/${i.id}`}>{i.number}</a><br /><span className="muted small">{i.reference}</span></td>
                  <td>{i.payer}</td>
                  <td>{formatDay(i.dueOn, "de")}<br /><span className={i.daysOverdue > 0 ? "small warn" : "muted small"}>{i.daysOverdue > 0 ? `${i.daysOverdue} Tage überfällig` : BUCKET_LABEL.not_due}</span></td>
                  <td><strong>{formatChf(i.openRappen)}</strong>{i.paidRappen ? <><br /><span className="muted small">von {formatChf(i.totalRappen)}</span></> : null}</td>
                  <td>
                    {i.lastLevel ? <span className="small">{DUNNING_LABEL[i.lastLevel]} gesendet</span> : null}
                    {i.nextLevel ? (
                      <form action={dun}>{hid}<input type="hidden" name="invoiceId" value={i.id} /><button className="btn secondary small">{DUNNING_LABEL[i.nextLevel]} senden</button></form>
                    ) : null}
                  </td>
                  <td>
                    <form action={pay} className="inline-form">
                      {hid}<input type="hidden" name="invoiceId" value={i.id} />
                      <input name="amount" defaultValue={(i.openRappen / 100).toFixed(2)} size={8} aria-label="Betrag" />
                      <input type="date" name="date" aria-label="Valuta" />
                      <button className="btn secondary small">Verbuchen</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <p className="muted">Keine offenen Rechnungen.</p>}
        <p className="muted small">Zahlungserinnerung ab 5 Tagen nach Fälligkeit, 1. Mahnung ab 20, 2. Mahnung ab 35 Tagen. Gesendet wird nur auf Knopfdruck, per E-Mail an die Adresse der Rechnung.</p>
      </section>

      <section className="card stack">
        <h2>Zahlungseingang aus Bankdatei</h2>
        <p className="muted small">Laden Sie die Datei «camt.054» (Gutschriftsanzeige) Ihrer Bank hoch. Zahlungen mit der QR-Referenz einer offenen Rechnung werden verbucht, jeder Eintrag nur einmal.</p>
        <form action={importFile} className="inline-form" encType="multipart/form-data">
          {hid}<input type="file" name="file" accept=".xml,text/xml" required /><button className="btn">Einlesen</button>
        </form>
      </section>

      <section className="card stack">
        <h2>Firmenkunden</h2>
        <p className="muted small">Buchungen lassen sich in der Buchung einer Firma zuordnen. Die Rechnung geht dann an die Firma, mit deren Zahlungsfrist.</p>
        {firms.map((f) => (
          <details key={f.id}>
            <summary>{f.name}{f.active ? "" : " (inaktiv)"} <span className="muted small">{f.city}{f.paymentDays != null ? ` · ${f.paymentDays} Tage` : ""}</span></summary>
            <CompanyForm f={f} hid={hid} />
          </details>
        ))}
        <details>
          <summary><strong>Firma hinzufügen</strong></summary>
          <CompanyForm hid={hid} />
        </details>
      </section>
    </div>
  );
}

function CompanyForm({ f, hid }: { f?: Awaited<ReturnType<typeof listCompanies>>[number]; hid: React.ReactNode }) {
  return (
    <form action={company} className="stack">
      {hid}{f ? <input type="hidden" name="id" value={f.id} /> : null}
      <div className="inline-form">
        <div><label>Firma</label><input name="name" required maxLength={120} defaultValue={f?.name} /></div>
        <div><label>E-Mail für Rechnungen</label><input type="email" name="email" maxLength={200} defaultValue={f?.email} /></div>
        <div><label>Zahlungsfrist (Tage, leer = Standard)</label><input type="number" name="days" min={0} max={365} defaultValue={f?.paymentDays ?? ""} style={{ width: 90 }} /></div>
      </div>
      <div className="inline-form">
        <div><label>Strasse</label><input name="street" maxLength={100} defaultValue={f?.street} /></div>
        <div><label>PLZ</label><input name="zip" maxLength={16} defaultValue={f?.zip} style={{ width: 90 }} /></div>
        <div><label>Ort</label><input name="city" maxLength={60} defaultValue={f?.city} /></div>
        <div><label>Land</label><input name="country" maxLength={2} defaultValue={f?.country ?? "CH"} style={{ width: 60 }} /></div>
        <div><label>MWST-Nr.</label><input name="vatId" maxLength={40} defaultValue={f?.vatId} /></div>
      </div>
      <div><label>Notiz</label><input name="note" maxLength={500} defaultValue={f?.note} /></div>
      <label className="check"><input type="checkbox" name="active" defaultChecked={f?.active ?? true} />Aktiv</label>
      <div><button className="btn small">Speichern</button></div>
    </form>
  );
}
