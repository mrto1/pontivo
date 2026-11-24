import { Notice } from "@/components/admin/Notice";
import { DownloadLink } from "@/components/admin/DownloadLink";
import { InfoTip } from "@/components/admin/InfoTip";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { IMPORT_COLUMNS, KIND_LABEL } from "@/src/domain/import-csv";
import { todayIn } from "@/src/domain/dates";
import { inParallel, setPreviousSoftware, createImportCheck, getImport, ImportError, invoiceCounter, listImports, runImport, setInvoiceStart, undoImport } from "@/src/services/migration";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";
const back = (id: string, q: string) => { revalidatePath(`/admin/${id}`, "layout"); return redirect(`/admin/${id}/migration?${q}`); }; // Layout neu: Banner und Chip hängen vom Stand ab
const err = (id: string, e: unknown, job?: string): never => {
  if (!(e instanceof ImportError)) throw e;
  return back(id, `${job ? `job=${job}&` : ""}error=${encodeURIComponent(e.message)}`);
};

async function upload(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  const file = f.get("file");
  if (!(file instanceof File) || !file.size) return back(c.hotel.id, `error=${encodeURIComponent("Bitte eine CSV-Datei wählen.")}`);
  let id = "";
  try { id = (await createImportCheck(c.hotel, await file.text(), file.name, c.actor)).id; } catch (e) { err(c.hotel.id, e); }
  back(c.hotel.id, `job=${id}`);
}
async function run(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  const job = s(f, "job");
  try { await runImport(c.hotel, job, c.actor); } catch (e) { err(c.hotel.id, e, job); }
  back(c.hotel.id, `job=${job}&msg=${encodeURIComponent("Import ausgeführt. Bitte prüfen Sie die Stichproben unten.")}`);
}
async function undo(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  const job = s(f, "job");
  try { await undoImport(c.hotel, job, c.actor); } catch (e) { err(c.hotel.id, e, job); }
  back(c.hotel.id, `job=${job}&msg=${encodeURIComponent("Import rückgängig gemacht.")}`);
}
async function parallelToggle(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await setPreviousSoftware(c.hotel, s(f, "answer") === "yes" ? "yes" : "none", c.actor);
  back(c.hotel.id, `msg=${encodeURIComponent("Gespeichert.")}`);
}
async function invoiceStart(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  try { await setInvoiceStart(c.hotel, Number(s(f, "year")), Number(s(f, "next")), c.actor); } catch (e) { err(c.hotel.id, e); }
  back(c.hotel.id, `msg=${encodeURIComponent("Nächste Rechnungsnummer gesetzt.")}`);
}

const STATUS: Record<string, string> = { checked: "geprüft", done: "ausgeführt", undone: "rückgängig", running: "läuft", failed: "fehlgeschlagen" };

export default async function Migration({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "manager", "migration");
  const jobs = await listImports(hotel.id);
  const job = sp.job ? await getImport(hotel.id, sp.job).catch(() => null) : null;
  const year = Number(todayIn(hotel.timezone).slice(0, 4));
  const last = await invoiceCounter(hotel.id, year);
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  const sm = job?.summary;
  return (
    <div className="stack">
      <h1>Datenübernahme<InfoTip>Reservierungen aus Ihrer bisherigen Software übernehmen. Zuerst wird die Datei nur geprüft, es wird nichts gespeichert. Erst wenn der Bericht keine Fehler zeigt, können Sie den Import ausführen. Er lässt sich rückgängig machen.</InfoTip></h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      {sp.error ? <p className="notice warn" role="alert">{sp.error}</p> : null}

      <section className="card stack">
        <h2>Ihre bisherige Software</h2>
        {inParallel(hotel)
          ? <p>Sie sind im <strong>Parallelbetrieb</strong>: Die bisherige Software läuft noch. Wenn alles übernommen ist, schliessen Sie mit der <a href={`/admin/${hotel.id}/migration/umschalten`}>Umschalt-Checkliste</a> ab.</p>
          : hotel.onboarding.switchover?.switchedAt
            ? <p>Umgeschaltet am {new Date(hotel.onboarding.switchover.switchedAt).toLocaleDateString("de-CH")}. Übernahmen lassen sich 30 Tage lang rückgängig machen. <a href={`/admin/${hotel.id}/migration/umschalten`}>Checkliste ansehen</a></p>
            : <p className="muted">Sie starten ohne Datenübernahme. Wenn Sie doch von einer anderen Software wechseln, schalten Sie den Parallelbetrieb ein.</p>}
        <form action={parallelToggle} className="inline-form">{H}
          <input type="hidden" name="answer" value={inParallel(hotel) ? "none" : "yes"} />
          <button className="btn secondary small">{inParallel(hotel) ? "Parallelbetrieb beenden (ohne Checkliste)" : "Ich wechsle von einer anderen Software"}</button>
        </form>
      </section>

      <section className="card stack">
        <h2>1. Datei vorbereiten</h2>
        <p>Exportieren Sie die Reservierungen aus Ihrer bisherigen Software als Excel/CSV und bringen Sie sie in das Format unserer Vorlage. Zimmertyp und Tarif müssen genau so heissen wie in Pontivo, legen Sie sie also vorher unter Einstellungen → Zimmer & Tarife an.</p>
        <p><DownloadLink href={`/admin/${hotel.id}/migration/vorlage`}>Vorlage Reservierungen (CSV)</DownloadLink></p>
        <p className="small muted">Gäste und Gutscheine übernehmen Sie mit denselben Schritten. Die Art der Datei erkennt Pontivo an der Kopfzeile: <strong>Gäste</strong> <code>vorname;nachname;email;telefon;sprache;marketing_einwilligung;einwilligung_am</code> (Einwilligung nur mit «ja» und Datum, sonst nicht übernommen), <strong>Gutscheine mit Restwert</strong> <code>code;betrag;restwert;gueltig_bis;kaeufer;kaeufer_email;empfaenger</code>. Reihenfolge: zuerst Zimmer in Pontivo anlegen, dann Gäste, Gutscheine, Reservierungen. Offene Rechnungen übernehmen wir nicht: Rechnungen der alten Software stellen Sie dort fertig, die Nummernreihe setzen Sie unten fort.</p>
        <details><summary>Spalten der Vorlage</summary>
          <table className="table small"><tbody>{IMPORT_COLUMNS.map((c) => <tr key={c.key}><td><code>{c.key}</code></td><td>{c.help}</td></tr>)}</tbody></table>
        </details>
        <p className="small muted">Der Gesamtpreis wird so übernommen, wie er in der Datei steht (keine Neuberechnung, keine Kurtaxe). Bereits bezahlte Beträge erscheinen als «Zahlung vor Ort». Es werden keine E-Mails an Gäste verschickt und keine Marketing-Einwilligungen übernommen. Vergangene Aufenthalte zählen für Statistik und Stammgäste, belegen aber keine Zimmer.</p>
      </section>

      <section className="card stack">
        <h2>2. Datei prüfen</h2>
        <form action={upload} className="stack">{H}
          <div><label htmlFor="file">CSV-Datei (Reservierungen höchstens 2000 Zeilen)</label><input id="file" name="file" type="file" accept=".csv,text/csv" required /></div>
          <div><button className="btn">Prüfen (Trockenlauf)</button></div>
        </form>
      </section>

      {job && sm ? (
        <section className="card stack" id="bericht">
          <h2>Prüfbericht: {job.filename || "Datei"} ({KIND_LABEL[sm.kind ?? "reservations"]}) <span className="badge">{STATUS[job.status] ?? job.status}</span></h2>
          <p>
            {sm.total} Zeilen · {sm.created} {job.status === "checked" ? "würden übernommen" : "übernommen"}{(sm.kind ?? "reservations") === "reservations" ? ` (${sm.future} laufende/künftige, ${sm.past} vergangene)` : ""} · {sm.skipped} schon vorhanden · <strong>{sm.errors} Fehler</strong> · {sm.warnings} Hinweise
          </p>
          {sm.issues.length ? (
            <table className="table small"><thead><tr><th>Zeile</th><th></th><th>Meldung</th></tr></thead>
              <tbody>{sm.issues.map((i, n) => <tr key={n}><td>{i.row}</td><td>{i.severity === "error" ? "Fehler" : "Hinweis"}</td><td>{i.message}</td></tr>)}</tbody></table>
          ) : null}
          {sm.sample.length ? (
            <>
              <h3>Stichprobe: Prüfen Sie diese Einträge</h3>
              <ul>{sm.sample.map((x) => <li key={x.row}>{x.ref}: {x.guest}{x.checkin ? `, ${x.checkin} bis ${x.checkout}` : ""}</li>)}</ul>
            </>
          ) : null}
          {sm.undone ? <p>Rückgängig: {sm.undone.removed} Buchungen entfernt{sm.undone.kept.length ? `; ${sm.undone.kept.length} bleiben bestehen: ${sm.undone.kept.map((k) => `${k.ref} (${k.reason})`).join(" ")}` : "."}</p> : null}
          {job.status === "checked" ? (
            sm.errors === 0 && sm.created > 0
              ? <form action={run}>{H}<input type="hidden" name="job" value={job.id} /><button className="btn">Import ausführen ({sm.created} {KIND_LABEL[sm.kind ?? "reservations"]})</button></form>
              : <p className="muted">Beheben Sie die Fehler in der Datei und prüfen Sie sie erneut.</p>
          ) : null}
          {job.status === "done" ? <form action={undo}>{H}<input type="hidden" name="job" value={job.id} /><button className="btn secondary">Import rückgängig machen</button></form> : null}
        </section>
      ) : null}

      <section className="card stack">
        <h2>Rechnungsnummern</h2>
        <p>Damit die Nummernreihe Ihrer bisherigen Software ohne Lücke weiterläuft: Geben Sie die <strong>nächste</strong> Rechnungsnummer ein. {last > 0 ? <>Zuletzt vergeben in {year}: {year}-{String(last).padStart(4, "0")}.</> : <>In {year} wurde noch keine Nummer vergeben.</>} Rückwärts geht es nicht, damit keine Nummer doppelt vorkommt.</p>
        <form action={invoiceStart} className="inline-form">{H}
          <div><label htmlFor="year">Jahr</label><input id="year" name="year" type="number" defaultValue={year} min={2000} max={2100} required /></div>
          <div><label htmlFor="next">Nächste Nummer</label><input id="next" name="next" type="number" defaultValue={last + 1} min={1} required /></div>
          <div><button className="btn secondary">Speichern</button></div>
        </form>
      </section>

      {atLeast(role, "owner") ? (
        <section className="card stack">
          <h2>Meine Daten exportieren</h2>
          <p>Alle Ihre Daten als ZIP mit einer CSV je Tabelle: Reservierungen (im Format der Vorlage, so können Sie jederzeit wechseln), Gäste, Zimmertypen, Tarife, Rechnungen, Gutscheine. Jederzeit und kostenlos.</p>
          <p><DownloadLink href={`/admin/${hotel.id}/migration/export`}>ZIP herunterladen</DownloadLink></p>
        </section>
      ) : null}

      {jobs.length ? (
        <section className="card stack">
          <h2>Bisherige Übernahmen</h2>
          <ul>{jobs.map((j) => <li key={j.id}><a href={`?job=${j.id}#bericht`}>{j.createdAt.toLocaleDateString("de-CH")} · {j.filename || "Datei"}</a> · {STATUS[j.status] ?? j.status} · {j.summary.created ?? 0} {KIND_LABEL[j.summary.kind ?? "reservations"]}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}
