import { Notice } from "@/components/admin/Notice";
import { Fragment } from "react";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import RateRows from "@/components/admin/RateRows";
import { PeriodNav } from "@/components/admin/PeriodNav";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { calendarData, setBlocked, updateRatesBatch, type RateChange, type RateRow } from "@/src/services/inventory";
import { addDays, isDay, todayIn, weekday } from "@/src/domain/dates";
import { decimalToRappen, rappenToDecimal } from "@/src/domain/money";

export const dynamic = "force-dynamic";

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const RANGES = [{ days: 14, label: "2 Wochen" }, { days: 31, label: "1 Monat" }, { days: 90, label: "3 Monate" }];
const MAX_ROWS = 12;

function tri(v: FormDataEntryValue | null): boolean | undefined {
  return v === "yes" ? true : v === "no" ? false : undefined;
}

async function saveRates(formData: FormData) {
  "use server";
  const hotelId = String(formData.get("hotelId"));
  const { actor } = await requireHotel(hotelId, "manager");
  const back = `/admin/${hotelId}/calendar?from=${formData.get("viewFrom")}&days=${formData.get("viewDays") ?? ""}`;
  const count = Math.min(MAX_ROWS, Number(formData.get("rows") ?? 1) || 1);
  const rows: RateRow[] = [];
  for (let i = 0; i < count; i++) {
    const g = (k: string) => String(formData.get(`${k}${i}`) ?? "").trim();
    const ratePlanId = g("ratePlanId");
    if (!ratePlanId) continue;
    const from = g("from");
    const to = g("to") || from;
    if (!isDay(from) || !isDay(to) || to < from) redirect(`${back}&msg=${encodeURIComponent(`Zeile ${i + 1}: ungültiger Zeitraum`)}`);
    const change: RateChange = {};
    const price = g("price");
    if (price) change.priceRappen = decimalToRappen(price.replace(",", "."));
    const minStay = g("minStay");
    if (minStay) change.minStayArrival = Math.max(1, Number(minStay));
    const maxStay = g("maxStay");
    if (maxStay) change.maxStay = Number(maxStay) > 0 ? Number(maxStay) : null;
    const cta = tri(formData.get(`cta${i}`));
    const ctd = tri(formData.get(`ctd${i}`));
    const ss = tri(formData.get(`stopSell${i}`));
    if (cta !== undefined) change.closedToArrival = cta;
    if (ctd !== undefined) change.closedToDeparture = ctd;
    if (ss !== undefined) change.stopSell = ss;
    if (Object.keys(change).length) rows.push({ ratePlanId, from, to, change });
  }
  let msg = "Keine Änderung angegeben";
  if (rows.length) {
    // Alle Zeilen in einer Transaktion → ein gemeinsamer Abgleich mit Channex
    const n = await updateRatesBatch(hotelId, rows, { weekdays: formData.getAll("wd").map(Number), actor });
    msg = `${n} Tage aktualisiert`;
  }
  revalidatePath(`/admin/${hotelId}/calendar`);
  redirect(`${back}&msg=${encodeURIComponent(msg)}`);
}

async function saveBlock(formData: FormData) {
  "use server";
  const hotelId = String(formData.get("hotelId"));
  const { actor } = await requireHotel(hotelId, "manager");
  const from = String(formData.get("from"));
  const to = String(formData.get("to"));
  const back = `/admin/${hotelId}/calendar?from=${formData.get("viewFrom")}&days=${formData.get("viewDays") ?? ""}`;
  if (!isDay(from) || !isDay(to) || to < from) redirect(`${back}&msg=${encodeURIComponent("Ungültiger Zeitraum")}`);
  const n = await setBlocked(hotelId, String(formData.get("roomTypeId")), from, to, Number(formData.get("blocked") ?? 0), {
    weekdays: formData.getAll("wd").map(Number),
    actor,
  });
  revalidatePath(`/admin/${hotelId}/calendar`);
  redirect(`${back}&msg=${encodeURIComponent(`${n} Tage aktualisiert`)}`);
}

function Weekdays() {
  return (
    <div>
      <label>Wochentage (leer = alle)</label>
      <div className="weekdays">
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <label key={d} className="chip"><input type="checkbox" name="wd" value={d} /><span>{WD[d]}</span></label>
        ))}
      </div>
    </div>
  );
}

export default async function Calendar({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "staff", "calendar");
  const today = todayIn(hotel.timezone);
  const from = sp.from && isDay(sp.from) ? sp.from : today;
  const span = RANGES.find((r) => String(r.days) === sp.days)?.days ?? 14;
  const cal = await calendarData(hotel.id, from, span);
  const days = Array.from({ length: span }, (_, i) => addDays(from, i));
  const invKey = new Map(cal.inventory.map((r) => [`${r.roomTypeId}|${r.night}`, r]));
  const rateKey = new Map(cal.rates.map((r) => [`${r.ratePlanId}|${r.night}`, r]));
  const canEdit = atLeast(role, "manager");

  return (
    <div className="stack">
      <div className="cal-head">
        <h1 className="sr-only">Kalender</h1>
        <PeriodNav
          prev={`?from=${addDays(from, -span)}&days=${span}`}
          next={`?from=${addDays(from, span)}&days=${span}`}
          todayHref={`?from=${today}&days=${span}`}
          todayActive={from === today}
          jump={{ value: from, param: "from", keep: { days: String(span) } }}
        >
          <div className="seg" role="group" aria-label="Anzeige">
            {RANGES.map((r) => (
              <a key={r.days} href={`?from=${from}&days=${r.days}`} className={r.days === span ? "on" : ""}>{r.label}</a>
            ))}
          </div>
          <details className="export-pop">
            <summary className="btn secondary small">Excel-Export</summary>
            <form method="get" action={`/admin/${hotel.id}/calendar/csv`} className="export-card">
              <div><label>Von</label><input type="date" name="from" defaultValue={from} required /></div>
              <div><label>Bis (inkl.)</label><input type="date" name="to" defaultValue={addDays(from, span - 1)} required /></div>
              <button className="btn small">CSV herunterladen</button>
              <p className="muted small" style={{ margin: 0 }}>Höchstens 366 Tage, für Excel (Semikolon, UTF-8).</p>
            </form>
          </details>
        </PeriodNav>
      </div>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <p className="small muted" style={{ margin: 0 }}>Die Zahl ist die Anzahl <strong>freier Zimmer</strong> je Nacht. Rot = ausgebucht. Fahren Sie über eine Zahl (am Handy: antippen), sehen Sie, wie viele gebucht, gesperrt oder über ein Portal belegt sind.</p>
      <div className="scroll-x">
        <table className="cal">
          <thead>
            <tr>
              <th className="sticky">Zimmertyp / Rateplan</th>
              {days.map((d) => (
                <th key={d} className={weekday(d) === 0 || weekday(d) === 6 ? "we" : ""}>
                  {WD[weekday(d)]}<br />{d.slice(8, 10)}.{d.slice(5, 7)}.
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cal.roomTypes.map((rt) => (
              <Fragment key={rt.id}>
                <tr className="rt-row">
                  <td className="sticky"><strong>{rt.name}</strong> <span className="muted">({rt.roomCount} Zimmer)</span><span className="cal-lab">freie Zimmer pro Nacht</span></td>
                  {days.map((d) => {
                    const i = invKey.get(`${rt.id}|${d}`);
                    if (!i) return <td key={d} className="muted">–</td>;
                    const free = i.total - i.booked - i.blocked - i.externalBlocked;
                    return (
                      <td key={d} className={free <= 0 ? "full" : ""} tabIndex={0} data-tip-tone={free <= 0 ? "full" : ""} data-tip-title={`${rt.name} · ${WD[weekday(d)]} ${d.slice(8, 10)}.${d.slice(5, 7)}.`}
                        data-tip={`Frei\t${free}\nGebucht\t${i.booked}\nGesperrt\t${i.blocked}\nExtern belegt\t${i.externalBlocked}`}>
                        <span className="cal-free">{free}</span>
                      </td>
                    );
                  })}
                </tr>
                {!cal.ratePlans.some((p) => p.roomTypeId === rt.id) ? (
                  <tr className="rp-row">
                    <td className="sticky"><span className="rp-name muted">Kein Tarif</span></td>
                    <td colSpan={days.length} className="cal-notarif">
                      Ohne Tarif ist «{rt.name}» nicht buchbar und hier ohne Preise. {canEdit ? <a href={`/admin/${hotel.id}/rooms?rt=${rt.id}&tab=tarife&plan=neu`}>Tarif anlegen</a> : "Bitte den Inhaber oder Manager einen Tarif anlegen lassen."}
                    </td>
                  </tr>
                ) : null}
                {cal.ratePlans.filter((p) => p.roomTypeId === rt.id).map((p) => (
                  <tr key={p.id} className="rp-row">
                    <td className="sticky"><span className="rp-name">{p.name}</span><span className="cal-lab">Preis CHF pro Nacht</span></td>
                    {days.map((d) => {
                      const r = rateKey.get(`${p.id}|${d}`);
                      if (!r) return <td key={d} className="muted">–</td>;
                      const tags = [r.minStayArrival > 1 ? `min${r.minStayArrival}` : "", r.closedToArrival ? "CTA" : "", r.closedToDeparture ? "CTD" : "", r.stopSell ? "STOP" : ""].filter(Boolean);
                      return (
                        <td key={d} className={r.stopSell ? "ss" : ""}>
                          {rappenToDecimal(r.priceRappen).replace(/\.00$/, "")}
                          {tags.length ? <span className="tag">{tags.join(" ")}</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <div className="grid">
          <form action={saveRates} className="card stack" style={{ gridColumn: "1 / -1" }}>
            <h3>Preise und Regeln setzen</h3>
            <p className="muted small" style={{ margin: 0 }}>
              Mehrere Zeilen werden zusammen gespeichert. Leere Felder bleiben unverändert, Zeilen ohne Rateplan werden ignoriert.
            </p>
            <input type="hidden" name="hotelId" value={hotel.id} />
            <input type="hidden" name="viewFrom" value={from} />
            <input type="hidden" name="viewDays" value={span} />
            <RateRows
              plans={cal.ratePlans.map((p) => ({ id: p.id, label: `${cal.roomTypes.find((r) => r.id === p.roomTypeId)?.name} · ${p.name}` }))}
              defaultPlan={cal.ratePlans[0]?.id}
              from={from}
              to={addDays(from, 6)}
              currency={hotel.currency}
              max={MAX_ROWS}
            />
            <Weekdays />
            <button className="btn">Alle speichern</button>
          </form>

          <div className="cal-lower">
          <form action={saveBlock} className="card stack">
            <h3>Zimmer sperren / freigeben</h3>
            <p className="muted small" style={{ margin: 0 }}>
              Sperrt Zimmer für einen Zeitraum, zum Beispiel für Renovation oder Eigenbedarf. Mit Anzahl 0 geben Sie gesperrte Zimmer wieder frei.
            </p>
            <input type="hidden" name="hotelId" value={hotel.id} />
            <input type="hidden" name="viewFrom" value={from} />
            <input type="hidden" name="viewDays" value={span} />
            <div className="form-row">
              <div>
                <label>Zimmertyp</label>
                <select name="roomTypeId" required>
                  {cal.roomTypes.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.roomCount})</option>)}
                </select>
              </div>
              <div><label>Von</label><input type="date" name="from" defaultValue={from} required /></div>
              <div><label>Bis (inkl.)</label><input type="date" name="to" defaultValue={from} required /></div>
              <div><label>Gesperrte Zimmer</label><input name="blocked" type="number" min={0} defaultValue={1} required title="0 = freigeben" /></div>
            </div>
            <Weekdays />
            <div><button className="btn">Speichern</button></div>
          </form>

          <aside className="card stack">
            <h3>Zimmer & Tarife</h3>
            <p className="muted small" style={{ margin: 0 }}>
              Zimmertypen, Anzahl Zimmer, Fotos, Tarife und Extras ändern oder neu anlegen Sie unter «Einstellungen → Zimmer & Tarife». Der Kalender zeigt dann automatisch die neuen Zeilen.
            </p>
            <div><a className="btn secondary" href={`/admin/${hotel.id}/rooms`}>Zimmer anpassen</a></div>
            <p className="muted small">
              Preise automatisch nach Auslastung anpassen? Das geht unter <a href={`/admin/${hotel.id}/preise`}>Preisempfehlung</a>.
            </p>
          </aside>
        </div>
        </div>
      ) : null}
    </div>
  );
}
