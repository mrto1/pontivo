import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { closeDay, DayCloseError, dayTotals, getDayClose, listDayCloses } from "@/src/services/day-close";
import { todayIn } from "@/src/domain/dates";
import { formatChf } from "@/src/domain/money";
import { formatDay } from "@/src/i18n/dict";
import { PrintButton } from "@/components/admin/PrintButton";
import { db } from "@/src/db/client";

export const dynamic = "force-dynamic";

const METHOD: Record<string, string> = { cash: "Bar", card: "Karte", twint: "TWINT", bank: "Überweisung", other: "Andere" };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function close(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "staff", "dayclose");
  await requireModule(c.hotel.id, "invoicing");
  const day = s(f, "day");
  let msg = `Tag ${day} abgeschlossen.`;
  try {
    const counted = s(f, "counted");
    await closeDay(c.hotel, day, { cashCountedRappen: counted ? Math.round(Number(counted.replace(",", ".")) * 100) : null, note: s(f, "note") }, c.actor);
  } catch (e) {
    if (!(e instanceof DayCloseError)) throw e;
    msg = `Nicht abgeschlossen: ${e.message}`;
  }
  redirect(`/admin/${c.hotel.id}/invoices/tagesabschluss?day=${day}&msg=${encodeURIComponent(msg)}`);
}

export default async function DayClosePage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "staff", "dayclose");
  await requireModule(hotel.id, "invoicing");
  const today = todayIn(hotel.timezone);
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) && sp.day <= today ? sp.day : today;
  const [closed, totals, history] = await Promise.all([getDayClose(hotel.id, day), dayTotals(db(), hotel, day), listDayCloses(hotel.id, 30)]);
  const t = closed?.totals ?? totals;
  const onsiteTotal = Object.values(t.onsite).reduce((a, b) => a + b, 0);
  return (
    <div className="stack">
      <h1>Tagesabschluss</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      <form className="inline-form" method="get">
        <div><label htmlFor="day">Tag</label><input id="day" type="date" name="day" defaultValue={day} max={today} /></div>
        <button className="btn secondary small">Anzeigen</button>
      </form>
      <section className="card stack">
        <h2>{formatDay(day, "de")} {closed ? "· abgeschlossen" : "· offen"}</h2>
        <table className="table">
          <thead><tr><th>Zahlungen vor Ort</th><th style={{ textAlign: "right" }}>Betrag</th></tr></thead>
          <tbody>
            {Object.entries(t.onsite).map(([m, v]) => <tr key={m}><td>{METHOD[m] ?? m}</td><td style={{ textAlign: "right" }}>{formatChf(v)}</td></tr>)}
            {Object.keys(t.onsite).length === 0 ? <tr><td colSpan={2} className="muted">Keine Zahlungen vor Ort.</td></tr> : null}
            <tr><td><strong>Summe vor Ort</strong></td><td style={{ textAlign: "right" }}><strong>{formatChf(onsiteTotal)}</strong></td></tr>
            <tr><td>Online-Zahlungen (Stripe, nach Rückerstattung)</td><td style={{ textAlign: "right" }}>{formatChf(t.online)}</td></tr>
          </tbody>
        </table>
        <table className="table">
          <thead><tr><th>Rechnungen</th><th style={{ textAlign: "right" }}>Betrag</th></tr></thead>
          <tbody>
            <tr><td>{t.invoices.count} Rechnung(en), {t.invoices.creditNotes} Gutschrift(en), Total brutto</td><td style={{ textAlign: "right" }}>{formatChf(t.invoices.grossRappen)}</td></tr>
            {Object.entries(t.invoices.vatByBps).map(([bps, v]) => <tr key={bps}><td>darin MWST {(Number(bps) / 100).toFixed(1)} %</td><td style={{ textAlign: "right" }}>{formatChf(v)}</td></tr>)}
          </tbody>
        </table>
        {closed ? (
          <div className="stack">
            <p>Bargeld erwartet: {formatChf(closed.cashExpectedRappen)}{closed.cashCountedRappen !== null ? <> · gezählt: {formatChf(closed.cashCountedRappen)} · <strong>Differenz: {formatChf(closed.differenceRappen)}</strong></> : " · nicht gezählt"}</p>
            {closed.note ? <p>Notiz: {closed.note}</p> : null}
            <p className="muted small">Abgeschlossen von {closed.closedBy} am {closed.closedAt.toLocaleString("de-CH", { timeZone: hotel.timezone })}. Ein Abschluss wird nie geändert. Korrekturen gehören auf den heutigen Tag.</p>
            <div className="no-print"><PrintButton /></div>
          </div>
        ) : (
          <form action={close} className="stack">
            <input type="hidden" name="hotelId" value={hotel.id} />
            <input type="hidden" name="day" value={day} />
            <p>Erwartetes Bargeld aus Zahlungen vor Ort: <strong>{formatChf(t.onsite.cash ?? 0)}</strong></p>
            <div className="inline-form">
              <div><label htmlFor="counted">Gezähltes Bargeld (CHF, leer = nicht gezählt)</label><input id="counted" name="counted" inputMode="decimal" /></div>
              <div style={{ flex: 1 }}><label htmlFor="note">Notiz</label><input id="note" name="note" maxLength={500} /></div>
            </div>
            <p className="muted small">Nach dem Abschluss lässt sich auf diesen Tag nichts mehr buchen und keine Rechnung mehr ausstellen.</p>
            <div><button className="btn">Tag abschliessen</button></div>
          </form>
        )}
      </section>
      <section className="card">
        <h2>Letzte Abschlüsse</h2>
        {history.length ? (
          <table className="table"><thead><tr><th>Tag</th><th>Differenz Bargeld</th><th>Von</th></tr></thead><tbody>
            {history.map((h) => <tr key={h.id}><td><a href={`?day=${h.day}`}>{formatDay(h.day, "de")}</a></td><td>{h.cashCountedRappen === null ? "nicht gezählt" : formatChf(h.differenceRappen)}</td><td>{h.closedBy}</td></tr>)}
          </tbody></table>
        ) : <p className="muted">Noch kein Tag abgeschlossen.</p>}
      </section>
    </div>
  );
}
