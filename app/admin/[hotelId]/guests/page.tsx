import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { addDays, isDay, todayIn } from "@/src/domain/dates";
import { isMonth } from "@/src/services/report";
import { shiftMonth } from "@/src/services/overview";
import { TaxTable, SOURCE } from "@/components/admin/GuestTables";
import { arrivals, cantonRule, guestsModuleEnabled, isTaxQuarter, quarterOf, setGuestsModule, shiftQuarter, touristTaxList, touristTaxQuarter, verifyRegistration } from "@/src/services/guests";

export const dynamic = "force-dynamic";

const TABS = { arrivals: "Anreisen", register: "Gästeregister", tax: "Kurtaxe-Liste", settings: "Einstellungen" } as const;
type Tab = keyof typeof TABS;

async function toggle(f: FormData) {
  "use server";
  const c = await requireHotel(String(f.get("hotelId")), "manager");
  await setGuestsModule(c.hotel.id, f.get("enabled") === "1", c.actor);
  redirect(`/admin/${c.hotel.id}/guests?tab=${f.get("enabled") === "1" ? "arrivals" : "settings"}`);
}

async function verify(f: FormData) {
  "use server";
  const c = await requireHotel(String(f.get("hotelId")), "staff");
  await verifyRegistration(c.hotel.id, String(f.get("bookingId")), c.actor);
  redirect(`/admin/${c.hotel.id}/guests?tab=arrivals&day=${String(f.get("day"))}`);
}

export default async function Guests({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "staff", "guests");
  const enabled = await guestsModuleEnabled(hotel.id);
  const rule = await cantonRule(hotel.canton);
  const today = todayIn(hotel.timezone);
  const tab: Tab = enabled ? (sp.tab && sp.tab in TABS ? (sp.tab as Tab) : "arrivals") : "settings";
  const isManager = atLeast(role, "manager");
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;

  return (
    <div className="stack">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Gäste</h1>
        {enabled ? (
          <nav className="seg" aria-label="Bereich">
            {(Object.keys(TABS) as Tab[]).filter((t) => t !== "tax" || isManager).map((t) => (
              <a key={t} href={`?tab=${t}`} aria-current={t === tab ? "true" : undefined}>{TABS[t]}</a>
            ))}
          </nav>
        ) : null}
      </div>

      {tab === "arrivals" ? <ArrivalsTab hotelId={hotel.id} day={isDay(sp.day ?? "") ? sp.day! : today} today={today} hidden={hidden} /> : null}

      {tab === "register" ? (
        <section className="card">
          <h2 style={{ fontSize: "1.15rem" }}>Gästeregister exportieren</h2>
          <p className="muted small">Für die Polizei auf Verlangen. Jeder Export wird protokolliert. Enthält alle Meldescheine mit Anreise im Zeitraum, inklusive Geburtsdatum und Ausweisnummer.</p>
          <form method="get" action={`/admin/${hotel.id}/guests/register`} style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
            <div><label htmlFor="from">Anreise von</label><input id="from" type="date" name="from" defaultValue={addDays(today, -30)} required /></div>
            <div><label htmlFor="to">bis</label><input id="to" type="date" name="to" defaultValue={today} required /></div>
            <button className="btn small" name="format" value="csv">CSV</button>
            <button className="btn secondary small" name="format" value="pdf" formTarget="_blank">PDF / Drucken</button>
          </form>
        </section>
      ) : null}

      {tab === "tax" && isManager ? <TaxTab hotel={hotel} month={isMonth(sp.month) ? sp.month : today.slice(0, 7)} quarter={isTaxQuarter(sp.quarter) ? sp.quarter : sp.view === "quarter" ? quarterOf(today.slice(0, 7)) : null} /> : null}

      {tab === "settings" ? (
        <section className="card stack">
          <h2 style={{ fontSize: "1.15rem" }}>Modul Gäste {enabled ? <span className="badge">eingeschaltet</span> : <span className="badge warn">aus</span>}</h2>
          <p>Mit dem Modul füllen Gäste den Meldeschein vor der Anreise online aus. Sie erhalten 7 Tage vor Anreise einen Link per E-Mail (bei späterer Buchung sofort), auch bei Buchungen über Portale, wenn die E-Mail-Adresse bekannt ist. Am Empfang bestätigen Sie nur noch, dass Sie den Ausweis gesehen haben.</p>
          <table className="rows small">
            <tbody>
              <tr><td>Kanton</td><td>{hotel.canton}</td></tr>
              <tr><td>Aufbewahrung</td><td>{rule.retentionYears} Jahre nach Abreise{rule.retentionKnown ? "" : " (nicht geregelt, Annahme)"}, danach automatisch gelöscht</td></tr>
              <tr><td>Unterschrift</td><td>{rule.signatureRequired ? "verlangt (Kontaktperson unterschreibt online)" : "nicht verlangt"}</td></tr>
              <tr><td>Teilnehmerliste für Gruppen</td><td>{rule.groupListAllowed ? "erlaubt ab 6 Personen" : "nein, jede Person füllt den Meldeschein aus"}</td></tr>
              {rule.notes ? <tr><td>Regel</td><td>{rule.notes}{rule.sourceUrl ? <> · <a href={rule.sourceUrl} target="_blank" rel="noreferrer">Quelle</a></> : null}</td></tr> : null}
            </tbody>
          </table>
          <p className="small muted">Geburtsdatum, Ausweisnummer und Unterschrift werden verschlüsselt gespeichert. Zugriff haben nur Mitarbeitende dieses Hotels.</p>
          {isManager ? (
            <form action={toggle}>{hidden}<input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
              <button className={`btn${enabled ? " secondary" : ""}`}>{enabled ? "Modul ausschalten" : "Modul einschalten"}</button>
            </form>
          ) : <p className="small muted">Ein- und ausschalten kann die Geschäftsführung.</p>}
        </section>
      ) : null}
    </div>
  );
}

async function ArrivalsTab({ hotelId, day, today, hidden }: { hotelId: string; day: string; today: string; hidden: React.ReactNode }) {
  const list = await arrivals(hotelId, day);
  const done = list.filter((a) => a.registered > 0).length;
  return (
    <section className="stack">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <a className="btn secondary small" href={`?tab=arrivals&day=${addDays(day, -1)}`}>←</a>
        <form method="get"><input type="hidden" name="tab" value="arrivals" /><input type="date" name="day" defaultValue={day} style={{ width: 170 }} /></form>
        <a className="btn secondary small" href={`?tab=arrivals&day=${addDays(day, 1)}`}>→</a>
        {day !== today ? <a className="small" href="?tab=arrivals">Heute</a> : null}
        <span className="muted small">{list.length} Anreise{list.length === 1 ? "" : "n"} · {done} mit Meldeschein</span>
      </div>
      {list.length ? (
        <table className="table">
          <thead><tr><th>Gast</th><th>Personen</th><th>Zimmer</th><th>Abreise</th><th>Quelle</th><th>Meldeschein</th><th></th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.bookingId}>
                <td><strong>{a.guest || "–"}</strong><div className="small muted">{a.reference}</div>{a.names.length > 1 ? <div className="small muted">{a.names.join(", ")}</div> : null}</td>
                <td>{a.persons}</td>
                <td>{a.room ?? ""}</td>
                <td>{a.checkout}</td>
                <td>{SOURCE[a.source] ?? a.source}</td>
                <td>{a.verified ? <span className="badge">✓ Ausweis gesehen</span> : a.registered ? <span className="badge">✓ ausgefüllt ({a.registered})</span> : <span className="badge warn">offen</span>}</td>
                <td>
                  {a.registered && !a.verified ? (
                    <form action={verify}>{hidden}<input type="hidden" name="bookingId" value={a.bookingId} /><input type="hidden" name="day" value={day} />
                      <button className="btn small">Ausweis gesehen</button></form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted">Keine Anreisen an diesem Tag.</p>}
      <p className="small muted">Gäste ohne Meldeschein füllen ihn am Empfang über den Link in der Buchungsbestätigung aus (z. B. auf einem Tablet) oder auf Papier.</p>
    </section>
  );
}

async function TaxTab({ hotel, month, quarter }: { hotel: Awaited<ReturnType<typeof requireHotel>>["hotel"]; month: string; quarter: string | null }) {
  const r = quarter ? await touristTaxQuarter(hotel, quarter) : await touristTaxList(hotel, month);
  const key = quarter ?? month;
  const param = quarter ? "quarter" : "month";
  return (
    <section className="stack">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <nav className="seg" aria-label="Zeitraum">
          <a href={`?tab=tax&month=${month}`} aria-current={!quarter ? "true" : undefined}>Monat</a>
          <a href={`?tab=tax&quarter=${quarterOf(month)}`} aria-current={quarter ? "true" : undefined}>Quartal</a>
        </nav>
        <a className="btn secondary small" href={quarter ? `?tab=tax&quarter=${shiftQuarter(quarter, -1)}` : `?tab=tax&month=${shiftMonth(month, -1)}`}>←</a>
        {quarter ? <strong>{quarter.replace("-Q", " Q")}</strong> : <form method="get"><input type="hidden" name="tab" value="tax" /><input type="month" name="month" defaultValue={month} style={{ width: 170 }} /></form>}
        <a className="btn secondary small" href={quarter ? `?tab=tax&quarter=${shiftQuarter(quarter, 1)}` : `?tab=tax&month=${shiftMonth(month, 1)}`}>→</a>
        <a className="btn small" href={`/admin/${hotel.id}/guests/tax?${param}=${key}&format=csv`}>CSV</a>
        <a className="btn secondary small" href={`/admin/${hotel.id}/guests/tax?${param}=${key}&format=pdf`} target="_blank">PDF / Drucken</a>
      </div>
      <TaxTable r={r} />
    </section>
  );
}
