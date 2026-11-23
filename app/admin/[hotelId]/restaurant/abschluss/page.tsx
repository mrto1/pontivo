import { Notice } from "@/components/admin/Notice";
import { DownloadLink } from "@/components/admin/DownloadLink";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosError, closeDay, dayReportFor, listDayCloses, verifyHotel } from "@/src/services/pos";
import { offlineWarnings } from "@/src/services/pos-sync";
import { METHODS, METHOD_LABEL, type DayReport } from "@/src/domain/pos";
import { todayIn } from "@/src/domain/dates";
import { formatChf } from "@/src/domain/money";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function close(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "pos");
  const day = s(f, "day");
  let msg = `Tag ${day} abgeschlossen.`;
  try { await closeDay(c.hotel, day, Math.round(Number(s(f, "counted").replace(",", ".")) * 100), s(f, "note"), c.actor); }
  catch (e) { if (!(e instanceof PosError)) throw e; msg = `Nicht abgeschlossen: ${e.message}`; }
  redirect(`/admin/${c.hotel.id}/restaurant/abschluss?day=${day}&msg=${encodeURIComponent(msg)}`);
}

export default async function PosClosePage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  await requireModule(hotel.id, "pos");
  const today = todayIn(hotel.timezone);
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) && sp.day <= today ? sp.day : today;
  const [rep, closes, check, warn] = await Promise.all([dayReportFor(hotel.id, day), listDayCloses(hotel.id), verifyHotel(hotel.id), offlineWarnings(hotel.id)]);
  const closed = closes.find((c) => c.day === day);
  const r = (closed?.report as DayReport | undefined) ?? rep;
  return (
    <div className="stack">
      <h1>Kassenabschluss {day}</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <form className="card"><label htmlFor="day">Tag</label> <input id="day" name="day" type="date" defaultValue={day} max={today} /> <button className="btn secondary small">Anzeigen</button></form>
      <section className="card stack">
        <h2>Z-Bericht{closed ? " (abgeschlossen)" : ""}</h2>
        <p>{r.receipts} Bons, davon {r.reversals} Gegenbons{r.late ? `, ${r.late} verspätet verbucht` : ""}. Total {formatChf(r.totalRappen)}.</p>
        <table className="table"><thead><tr><th>Zahlart</th><th>Betrag</th><th>Trinkgeld</th></tr></thead><tbody>
          {METHODS.map((m) => <tr key={m}><td>{METHOD_LABEL[m]}</td><td>{formatChf(r.byMethod[m])}</td><td>{formatChf(r.tipsByMethod[m])}</td></tr>)}
        </tbody></table>
        <table className="table"><thead><tr><th>MWST</th><th>Brutto</th><th>Steuer</th><th>Netto</th></tr></thead><tbody>
          {r.vat.map((v) => <tr key={v.bps}><td>{(v.bps / 100).toFixed(1)} %</td><td>{formatChf(v.grossRappen)}</td><td>{formatChf(v.vatRappen)}</td><td>{formatChf(v.netRappen)}</td></tr>)}
        </tbody></table>
        <p><strong>Erwartetes Bargeld: {formatChf(r.expectedCashRappen)}</strong></p>
        {closed ? <p>Gezählt: {formatChf(closed.countedCashRappen)}, Differenz {formatChf(closed.differenceRappen)}{closed.note ? ` (${closed.note})` : ""}. Abgeschlossen von {closed.closedBy}.</p> : (
          <form action={close} className="stack">
            <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="day" value={day} />
            <div><label>Gezähltes Bargeld CHF</label><input name="counted" inputMode="decimal" required /></div>
            <div><label>Bemerkung</label><input name="note" maxLength={300} /></div>
            <div><button className="btn">Tag abschliessen</button></div>
          </form>
        )}
        <p><DownloadLink href={`/admin/${hotel.id}/restaurant/export?from=${day}&to=${day}`}>Bons dieses Tages (CSV)</DownloadLink> <DownloadLink href={`/admin/${hotel.id}/restaurant/export?from=${day.slice(0, 8)}01&to=${day}`}>Monat bis hier (CSV)</DownloadLink></p>
      </section>
      {warn.unsynced.length || warn.rejected.length || warn.unassigned.length ? (
        <section className="card stack">
          <h2>Offline-Kasse: bitte prüfen</h2>
          {warn.unsynced.map((u) => <p key={u.code} className="notice warn">Gerät {u.code}: {u.pending} Vorgänge noch nicht übertragen (zuletzt gesehen {u.lastSeenAt ? u.lastSeenAt.toLocaleString("de-CH") : "nie"}). Das Gerät bitte mit dem Internet verbinden, bevor der Tag abgeschlossen wird.</p>)}
          {warn.rejected.length ? <><p className="notice warn">Abgelehnte Offline-Bons (die Nummer fehlt in der Reihe, hier steht der Grund):</p><ul>{warn.rejected.map((r, i) => <li key={i}>{r.number ?? "?"}: {r.error} ({r.at.toLocaleString("de-CH")})</li>)}</ul></> : null}
          {warn.unassigned.length ? <><p className="notice warn">Aufs Zimmer gebucht, aber keiner Buchung zugeordnet (Gast abgereist oder Buchung nicht gefunden). Bitte von Hand in der Hotelrechnung erfassen:</p><ul>{warn.unassigned.map((u) => <li key={u.number}>{u.number}: {formatChf(u.total)} ({u.day})</li>)}</ul></> : null}
        </section>
      ) : null}
      <section className="card stack">
        <h2>Prüfung</h2>
        {check.brokenAtSeq === null ? <p className="notice">Bon-Kette in Ordnung ({check.receipts} Bons).</p> : <p className="notice warn">Bon-Kette ab Folge {check.brokenAtSeq} fehlerhaft. Bitte melden.</p>}
        {check.gaps.length ? <p className="notice warn">Lücken in der Nummerierung: {check.gaps.map((g) => `${g.code}: ${g.gaps.join(", ")}`).join("; ")}</p> : <p className="small muted">Keine Lücken in den Bon-Nummern.</p>}
      </section>
    </div>
  );
}
