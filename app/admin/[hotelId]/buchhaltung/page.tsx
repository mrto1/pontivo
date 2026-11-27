import { Notice } from "@/components/admin/Notice";
import { DownloadLink } from "@/components/admin/DownloadLink";
import { InfoTip } from "@/components/admin/InfoTip";
import { redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { AccountingExportError, accountsOf, journalFor, periodRange, saveAccounts } from "@/src/services/accounting-export";
import { ACCOUNT_KEYS, ACCOUNT_LABEL, type AccountMap } from "@/src/domain/accounting-export";
import { quarterOf } from "@/src/services/guests";
import { todayIn } from "@/src/domain/dates";
import { formatChf } from "@/src/domain/money";
import { formatDay } from "@/src/i18n/dict";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";


async function save(f: FormData) {
  "use server";
  const c = await requireHotelModule("accountingexport", s(f, "hotelId"), "manager");
  const input: Partial<AccountMap> = {};
  for (const k of ACCOUNT_KEYS) input[k] = s(f, k);
  let msg = "Konten gespeichert.";
  try { await saveAccounts(c.hotel, input, c.actor); } catch (e) { if (!(e instanceof AccountingExportError)) throw e; msg = e.message; }
  redirect(`/admin/${c.hotel.id}/buchhaltung?msg=${encodeURIComponent(msg)}`);
}

export default async function Buchhaltung({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotelModule("accountingexport", hotelId, "staff", "accountingexport");
  const today = todayIn(hotel.timezone);
  const period = periodRange(sp.p ?? "") ? sp.p! : today.slice(0, 7);
  const r = periodRange(period)!;
  const rows = await journalFor(hotel, r.from, r.to);
  const accounts = accountsOf(hotel);
  const manager = atLeast(role, "manager");
  const choices = [today.slice(0, 7), quarterOf(today.slice(0, 7)), today.slice(0, 4)];
  return (
    <div className="stack">
      <h1 className="sr-only">Buchhaltung</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <div><InfoTip label="Worum geht es hier?">Rechnungen (nach Ausstelldatum) und Zahlungen (nach Zahldatum) als Einzelbuchungen für Ihren Treuhänder. Allgemeines CSV mit Soll- und Haben-Konto, kein Format eines bestimmten Programms: Ihr Treuhänder kann es in bexio, Abacus oder andere Software übernehmen.</InfoTip></div>
      <form method="get" className="inline-form">
        <div><label htmlFor="f29ac1">Zeitraum</label><input className="u-w-170px" id="f29ac1" name="p" defaultValue={period} placeholder="2026-11, 2026-Q4 oder 2026" /></div>
        <button className="btn secondary small">Anzeigen</button>
        <span className="small">Schnell: {choices.map((c) => <a className="u-mr-8px" key={c} href={`?p=${c}`}>{c.replace("-Q", " Q")}</a>)}</span>
      </form>
      <section className="card stack">
        <h2>{r.label}: {rows.length} Buchungen</h2>
        {rows.length ? (
          <>
            <div className="scroll-x"><table className="table">
              <thead><tr><th>Datum</th><th>Beleg</th><th>Text</th><th>Soll</th><th>Haben</th><th>Betrag</th></tr></thead>
              <tbody>{rows.slice(0, 200).map((x, i) => <tr key={i}><td className="small">{formatDay(x.date, "de")}</td><td className="small">{x.doc}</td><td className="small">{x.text}</td><td>{x.debit}</td><td>{x.credit}</td><td>{formatChf(x.rappen)}</td></tr>)}</tbody>
            </table></div>
            {rows.length > 200 ? <p className="small muted">Die Vorschau zeigt die ersten 200 Buchungen, die Datei enthält alle.</p> : null}
            <p><DownloadLink href={`/admin/${hotel.id}/buchhaltung/csv?p=${period}`} primary>CSV herunterladen</DownloadLink> <DownloadLink href={`/admin/${hotel.id}/buchhaltung/csv?p=${period}&f=abacus`}>Für Abacus (FIBU ASCII Buchungen)</DownloadLink></p>
            <p className="small muted">Abacus-Datei: Felder nach der Abacus-Schnittstellenbeschreibung «FIBU – ASCII Buchungen» (2012.00). Die Dateiform ist dort nicht beschrieben; bitte zuerst mit einer Testdatei im Abacus Ihres Treuhänders einlesen. Kontonummern müssen reine Ziffern sein. Infoniqa folgt, sobald das Format bestätigt ist.</p>
          </>
        ) : <p className="muted small">Keine Buchungen in diesem Zeitraum.</p>}
      </section>
      <section className="card stack">
        <h2>Konten</h2>
        <p className="small muted">Kontonummern Ihres Kontenplans. Die Vorgaben sind nur ein Vorschlag nach dem Schweizer Kontenrahmen KMU. Bitte mit Ihrem Treuhänder abstimmen, bevor Sie die Datei einlesen. Stripe-Gebühren und Auszahlungen sind nicht enthalten (Abstimmung über den Stripe-Auszug).</p>
        <form action={save} className="stack">
          <input type="hidden" name="hotelId" value={hotel.id} />
          <fieldset className="plain" disabled={!manager}><div className="form-grid">
            {ACCOUNT_KEYS.map((k) => <div key={k}><label htmlFor={`acc-${k}`}>{ACCOUNT_LABEL[k]}</label><input id={`acc-${k}`} name={k} defaultValue={accounts[k]} maxLength={20} /></div>)}
          </div></fieldset>
          {manager ? <div><button className="btn small">Konten speichern</button></div> : null}
        </form>
      </section>
    </div>
  );
}
