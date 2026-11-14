import { notFound, redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { createCreditNote, deleteDraft, InvoiceError, invoiceView, issueInvoice, sendInvoiceEmail, updateDraft } from "@/src/services/invoicing";
import { formatChf } from "@/src/domain/money";
import { formatBps } from "@/src/domain/invoice";
import { formatDay } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function act(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>, id: string) => Promise<string | { to: string }>) {
  const c = await requireHotel(s(f, "hotelId"), "staff");
  await requireModule(c.hotel.id, "invoicing");
  const id = s(f, "invoiceId");
  let out: string | { to: string };
  try {
    out = await fn(c, id);
  } catch (e) {
    if (!(e instanceof InvoiceError)) throw e;
    out = `Nicht möglich: ${e.message}`;
  }
  if (typeof out !== "string") redirect(out.to);
  redirect(`/admin/${c.hotel.id}/invoices/${id}?msg=${encodeURIComponent(out)}`);
}

async function save(f: FormData) {
  "use server";
  await act(f, async (c, id) => {
    await updateDraft(c.hotel.id, id, { recipient: { name: s(f, "name"), company: s(f, "company"), street: s(f, "street"), zip: s(f, "zip"), city: s(f, "city"), country: s(f, "country"), vatId: s(f, "vatId"), email: s(f, "email") }, note: s(f, "note") }, c.actor);
    return "Gespeichert.";
  });
}
async function issue(f: FormData) {
  "use server";
  await act(f, async (c, id) => { await updateIfPresent(f, c, id); const i = await issueInvoice(c.hotel, id, c.actor); return `Ausgestellt als ${i.number}.`; });
}
async function updateIfPresent(f: FormData, c: Awaited<ReturnType<typeof requireHotel>>, id: string) {
  if (f.has("name")) await updateDraft(c.hotel.id, id, { recipient: { name: s(f, "name"), company: s(f, "company"), street: s(f, "street"), zip: s(f, "zip"), city: s(f, "city"), country: s(f, "country"), vatId: s(f, "vatId"), email: s(f, "email") }, note: s(f, "note") }, c.actor);
}
async function mail(f: FormData) {
  "use server";
  await act(f, async (c, id) => { await sendInvoiceEmail(c.hotel, id, c.actor); return "E-Mail wird gesendet."; });
}
async function discard(f: FormData) {
  "use server";
  await act(f, async (c, id) => { await deleteDraft(c.hotel.id, id, c.actor); return { to: `/admin/${c.hotel.id}/invoices?msg=${encodeURIComponent("Entwurf gelöscht.")}` }; });
}
async function credit(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "invoicing");
  let to: string;
  try {
    const cn = await createCreditNote(c.hotel, s(f, "invoiceId"), c.actor);
    to = `/admin/${c.hotel.id}/invoices/${cn.id}?msg=${encodeURIComponent(`Gutschrift ${cn.number} erstellt.`)}`;
  } catch (e) {
    if (!(e instanceof InvoiceError)) throw e;
    to = `/admin/${c.hotel.id}/invoices/${s(f, "invoiceId")}?msg=${encodeURIComponent(`Nicht möglich: ${e.message}`)}`;
  }
  redirect(to);
}

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ hotelId: string; invoiceId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId, invoiceId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  await requireModule(hotel.id, "invoicing");
  const v = await invoiceView(hotel, invoiceId);
  if (!v) notFound();
  const { invoice: inv } = v;
  const draft = inv.status === "draft";
  const hid = (<><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="invoiceId" value={inv.id} /></>);
  const r = inv.recipient;
  const isCredit = inv.kind === "credit_note";
  return (
    <div className="stack">
      <h1>{isCredit ? "Gutschrift" : "Rechnung"} {inv.number ?? "(Entwurf)"}</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      <p className="small">
        <a href={`/admin/${hotel.id}/invoices`}>← Alle Rechnungen</a>
        {inv.bookingId ? <> · <a href={`/admin/${hotel.id}/bookings/${inv.bookingId}#kasse`}>Buchung</a></> : null}
        {!draft ? <> · <a href={`/admin/${hotel.id}/invoices/${inv.id}/print`} target="_blank">Druckansicht / PDF</a></> : null}
      </p>

      <section className="card stack">
        <h2>Empfänger</h2>
        {draft ? (
          <form action={save} className="stack">
            {hid}
            <div className="form-grid">
              <div><label>Name</label><input name="name" defaultValue={r.name ?? ""} /></div>
              <div><label>Firma (optional)</label><input name="company" defaultValue={r.company ?? ""} /></div>
              <div><label>Strasse und Nr.</label><input name="street" defaultValue={r.street ?? ""} /></div>
              <div><label>PLZ</label><input name="zip" defaultValue={r.zip ?? ""} /></div>
              <div><label>Ort</label><input name="city" defaultValue={r.city ?? ""} /></div>
              <div><label>Land (2 Buchstaben)</label><input name="country" maxLength={2} defaultValue={r.country ?? "CH"} /></div>
              <div><label>MWST-/UID-Nr. des Empfängers (optional)</label><input name="vatId" defaultValue={r.vatId ?? ""} /></div>
              <div><label>E-Mail (optional)</label><input name="email" defaultValue={r.email ?? ""} /></div>
            </div>
            <div><label>Bemerkung auf der Rechnung (optional)</label><input name="note" defaultValue={inv.note} maxLength={500} /></div>
            <p className="muted small">Mit vollständiger Adresse (Strasse, PLZ, Ort) erscheint der Empfänger auch im Zahlteil der QR-Rechnung.</p>
            <div className="inline-form">
              <button className="btn secondary small">Speichern</button>
              <button className="btn small" formAction={issue}>Speichern und ausstellen</button>
            </div>
          </form>
        ) : (
          <p>{[r.company, r.name, r.street, [r.zip, r.city].filter(Boolean).join(" "), r.vatId ? `MWST-Nr. ${r.vatId}` : ""].filter(Boolean).join(" · ") || "–"}</p>
        )}
      </section>

      <section className="card stack">
        <h2>Positionen</h2>
        <div className="scroll-x"><table className="table">
          <thead><tr><th>Beschreibung</th><th>Menge</th><th>Preis</th><th>MWST</th><th>Betrag</th></tr></thead>
          <tbody>
            {v.lines.map((l) => <tr key={l.id}><td>{l.description}</td><td>{l.quantity}</td><td>{formatChf(l.unitPriceRappen)}</td><td className="small">{l.vatBps ? formatBps(l.vatBps) : "–"}</td><td>{formatChf(l.amountRappen)}</td></tr>)}
            <tr><td colSpan={4}><strong>Total (inkl. MWST)</strong></td><td><strong>{formatChf(inv.totalRappen)}</strong></td></tr>
          </tbody>
        </table></div>
        {v.vat.vatRappen !== 0 || v.vat.rows.some((x) => x.bps > 0) ? (
          <p className="small muted">MWST: {v.vat.rows.filter((x) => x.bps > 0).map((x) => `${formatBps(x.bps)} auf ${formatChf(x.netRappen)} = ${formatChf(x.vatRappen)}`).join(" · ")}</p>
        ) : <p className="small muted">Ohne MWST.</p>}
        {!isCredit ? (
          <p className="small">Bezahlt: {formatChf(v.paidRappen)} · <strong>{v.openRappen > 0 ? `offen ${formatChf(v.openRappen)}` : "bezahlt"}</strong>{inv.dueOn && v.openRappen > 0 ? ` · fällig am ${formatDay(inv.dueOn, "de")}` : ""}</p>
        ) : null}
        {inv.emailedAt ? <p className="small muted">Per E-Mail gesendet am {inv.emailedAt.toLocaleString("de-CH", { timeZone: hotel.timezone })}.</p> : null}
        {v.qrNote ? <p className="notice warn small">{v.qrNote}</p> : null}
      </section>

      <div className="inline-form">
        {draft ? <form action={discard}>{hid}<button className="btn secondary small">Entwurf verwerfen</button></form> : null}
        {!draft ? <form action={mail}>{hid}<button className="btn secondary small">{inv.emailedAt ? "Erneut per E-Mail senden" : "Per E-Mail senden"}</button></form> : null}
        {!draft && !isCredit && role !== "staff" ? <form action={credit}>{hid}<button className="btn secondary small">Gutschrift erstellen (Rechnung stornieren)</button></form> : null}
      </div>
    </div>
  );
}
