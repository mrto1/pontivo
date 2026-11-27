import { Notice } from "@/components/admin/Notice";
import Link from "next/link";
import { Drawer, DrawerActions } from "@/components/admin/Drawer";
import { RowList } from "@/components/admin/RowList";
import { redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { InvoiceError } from "@/src/services/invoicing";
import {
  DebtorError, agingTotals, importBankFile, listCompanies, listOpenInvoices, recordInvoicePayment, saveCompany, sendDunning,
} from "@/src/services/debtors";
import { BUCKET_LABEL, DUNNING_LABEL, type Bucket } from "@/src/domain/debtors";
import { decimalToRappen, formatChf } from "@/src/domain/money";
import { formatDay } from "@/src/i18n/dict";
import { s } from "@/src/lib/form";
import { hotelAction, type HotelCtx } from "@/src/lib/hotel-action";

export const dynamic = "force-dynamic";
const BUCKETS: Bucket[] = ["not_due", "d1_30", "d31_60", "d60_plus"];

const run = (f: FormData, fn: (c: HotelCtx) => Promise<string>) =>
  hotelAction(f, { page: "invoices/debitoren", module: "invoicing", area: "debtors", fail: "Nicht möglich" }, async (c) => {
    await requireModule(c.hotel.id, "debtors");
    return fn(c);
  });

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
  const days0 = s(f, "days");
  await hotelAction(f, { page: "invoices/debitoren", module: "invoicing", area: "debtors", ok: "Firma gespeichert.", reopen: { firma: s(f, "id") || "neu" } }, async (c) => {
    await requireModule(c.hotel.id, "debtors");
    await saveCompany(c.hotel.id, s(f, "id") || null, { name: s(f, "name"), street: s(f, "street"), zip: s(f, "zip"), city: s(f, "city"), country: s(f, "country"), vatId: s(f, "vatId"), email: s(f, "email"), paymentDays: days0 === "" ? null : Number(days0), note: s(f, "note"), active: f.get("active") === "on" }, c.actor);
  });
}

export default async function Debtors({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("invoicing", hotelId, "staff", "debtors");
  await requireModule(hotel.id, "debtors");
  const [open, firms] = await Promise.all([listOpenInvoices(hotel), listCompanies(hotel.id)]);
  const aging = agingTotals(open);
  const hid = <input type="hidden" name="hotelId" value={hotel.id} />;
  const firm = sp.firma && sp.firma !== "neu" ? firms.find((f) => f.id === sp.firma) ?? null : null;
  const drawer = sp.firma === "neu" || !!firm;
  const close = `/admin/${hotel.id}/invoices/debitoren`;
  return (
    <div className="stack">
      <h1 className="sr-only">Debitoren</h1>
      {sp.msg && !drawer ? <Notice text={sp.msg} /> : null}
      {drawer ? (
        <Drawer title={firm ? firm.name : "Neue Firma"} closeHref={close}>
          {sp.msg ? <Notice text={sp.msg} /> : null}
          <CompanyForm f={firm ?? undefined} hid={hid} close={close} />
        </Drawer>
      ) : null}

      <section className="card stack">
        <h2>Offene Rechnungen: {formatChf(open.reduce((a, i) => a + i.openRappen, 0))}</h2>
        <div className="inline-form">{BUCKETS.map((b) => <div key={b}><span className="muted small">{BUCKET_LABEL[b]}</span><br /><strong>{formatChf(aging[b])}</strong></div>)}</div>
        {open.length ? (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Rechnung</th><th>Zahler</th><th>Fällig</th><th>Offen</th><th>Mahnung</th><th>Zahlungseingang</th></tr></thead>
            <tbody>
              {open.map((i) => (
                <tr key={i.id}>
                  <td><a href={`/admin/${hotel.id}/invoices/${i.id}`}>{i.number}</a><br /><span className="muted small">{i.reference}</span></td>
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
        {firms.length ? <RowList rows={firms.map((f) => ({ id: f.id, href: `?firma=${f.id}`, label: `${f.name} bearbeiten`, title: f.name, detail: [f.city, f.paymentDays != null ? `${f.paymentDays} Tage Zahlungsfrist` : "", f.email].filter(Boolean).join(" · "), badges: f.active ? [] : [{ text: "inaktiv" }] }))} /> : <p className="muted m0">Noch keine Firma.</p>}
        <div><Link className="btn secondary" href="?firma=neu" scroll={false}>+ Firma hinzufügen</Link></div>
      </section>
    </div>
  );
}

function CompanyForm({ f, hid, close }: { f?: Awaited<ReturnType<typeof listCompanies>>[number]; hid: React.ReactNode; close: string }) {
  return (
    <form action={company} className="stack">
      {hid}{f ? <input type="hidden" name="id" value={f.id} /> : null}
      <div className="form-grid">
        <div><label htmlFor="fb0551">Firma</label><input id="fb0551" name="name" required maxLength={120} defaultValue={f?.name} /></div>
        <div><label htmlFor="fb0552">E-Mail für Rechnungen</label><input id="fb0552" type="email" name="email" maxLength={200} defaultValue={f?.email} /></div>
        <div><label htmlFor="fb0554">Strasse</label><input id="fb0554" name="street" maxLength={100} defaultValue={f?.street} /></div>
        <div><label htmlFor="fb0555">PLZ</label><input id="fb0555" name="zip" maxLength={16} defaultValue={f?.zip} /></div>
        <div><label htmlFor="fb0556">Ort</label><input id="fb0556" name="city" maxLength={60} defaultValue={f?.city} /></div>
        <div><label htmlFor="fb0557">Land</label><input id="fb0557" name="country" maxLength={2} defaultValue={f?.country ?? "CH"} /></div>
        <div><label htmlFor="fb0558">MWST-Nr.</label><input id="fb0558" name="vatId" maxLength={40} defaultValue={f?.vatId} /></div>
        <div><label htmlFor="fb0553">Zahlungsfrist (Tage, leer = Standard)</label><input id="fb0553" type="number" name="days" min={0} max={365} defaultValue={f?.paymentDays ?? ""} /></div>
      </div>
      <div><label htmlFor="fb0559">Notiz</label><input id="fb0559" name="note" maxLength={500} defaultValue={f?.note} /></div>
      <label className="check"><input type="checkbox" name="active" defaultChecked={f?.active ?? true} />Aktiv</label>
      <DrawerActions submit={f ? "Speichern" : "Firma anlegen"} cancelHref={close} />
    </form>
  );
}
