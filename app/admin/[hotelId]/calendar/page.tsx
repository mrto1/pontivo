import { Fragment } from "react";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { calendarData, setBlocked, updateRatesBatch, type RateChange, type RateRow } from "@/src/services/inventory";
import { addDays, isDay, todayIn, weekday } from "@/src/domain/dates";
import { decimalToRappen, rappenToDecimal } from "@/src/domain/money";

export const dynamic = "force-dynamic";

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const DAYS = 90;
const MAX_ROWS = 12;

function tri(v: FormDataEntryValue | null): boolean | undefined {
  return v === "yes" ? true : v === "no" ? false : undefined;
}

async function saveRates(formData: FormData) {
  "use server";
  const hotelId = String(formData.get("hotelId"));
  const { actor } = await requireHotel(hotelId, "manager");
  const back = `/admin/${hotelId}/calendar?from=${formData.get("viewFrom")}`;
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
  const back = `/admin/${hotelId}/calendar?from=${formData.get("viewFrom")}`;
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
          <label key={d}><input type="checkbox" name="wd" value={d} />{WD[d]}</label>
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
  const cal = await calendarData(hotel.id, from, DAYS);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(from, i));
  const invKey = new Map(cal.inventory.map((r) => [`${r.roomTypeId}|${r.night}`, r]));
  const rateKey = new Map(cal.rates.map((r) => [`${r.ratePlanId}|${r.night}`, r]));
  const canEdit = atLeast(role, "manager");
  const rowCount = Math.min(MAX_ROWS, Math.max(1, Number(sp.rows) || 3));

  return (
    <div className="stack">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Kalender</h1>
        <a className="btn secondary small" href={`?from=${addDays(from, -30)}`}>← 30 Tage</a>
        <a className="btn secondary small" href={`?from=${today}`}>Heute</a>
        <a className="btn secondary small" href={`?from=${addDays(from, 30)}`}>30 Tage →</a>
      </div>
      {sp.msg ? <p className="notice">{sp.msg}</p> : null}
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
                <tr>
                  <td className="sticky">{rt.name} <span className="muted">({rt.roomCount})</span><br /><span className="muted small">frei / gebucht / gesperrt</span></td>
                  {days.map((d) => {
                    const i = invKey.get(`${rt.id}|${d}`);
                    if (!i) return <td key={d} className="muted">–</td>;
                    const free = i.total - i.booked - i.blocked - i.externalBlocked;
                    return (
                      <td key={d} className={free <= 0 ? "full" : ""} title={`frei ${free}, gebucht ${i.booked}, gesperrt ${i.blocked}, extern belegt ${i.externalBlocked}`}>
                        {free}
                        <span className="muted"> /{i.booked}</span>
                        {i.blocked ? <span className="blk"> /{i.blocked}</span> : null}
                      </td>
                    );
                  })}
                </tr>
                {cal.ratePlans.filter((p) => p.roomTypeId === rt.id).map((p) => (
                  <tr key={p.id}>
                    <td className="sticky" style={{ fontWeight: 400 }}>↳ {p.name}</td>
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
            <input type="hidden" name="rows" value={rowCount} />
            <div className="scroll-x">
              <table className="rate-rows">
                <thead>
                  <tr>
                    <th>Rateplan</th><th>Von</th><th>Bis (inkl.)</th><th>Preis {hotel.currency}</th><th>Min. Nächte</th><th>Max. Nächte</th>
                    <th>Anreise gesperrt</th><th>Abreise gesperrt</th><th>Verkaufsstopp</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: rowCount }, (_, i) => (
                    <tr key={i}>
                      <td>
                        <select name={`ratePlanId${i}`} defaultValue={i === 0 ? cal.ratePlans[0]?.id : ""} aria-label={`Rateplan Zeile ${i + 1}`}>
                          <option value="">–</option>
                          {cal.ratePlans.map((p) => (
                            <option key={p.id} value={p.id}>{cal.roomTypes.find((r) => r.id === p.roomTypeId)?.name} · {p.name}</option>
                          ))}
                        </select>
                      </td>
                      <td><input type="date" name={`from${i}`} defaultValue={i === 0 ? from : undefined} aria-label="Von" /></td>
                      <td><input type="date" name={`to${i}`} defaultValue={i === 0 ? addDays(from, 6) : undefined} aria-label="Bis" /></td>
                      <td><input name={`price${i}`} inputMode="decimal" placeholder="–" size={7} aria-label="Preis" /></td>
                      <td><input name={`minStay${i}`} type="number" min={1} placeholder="–" style={{ width: 70 }} aria-label="Mindestnächte" /></td>
                      <td><input name={`maxStay${i}`} type="number" min={0} placeholder="–" title="0 = keine Begrenzung" style={{ width: 70 }} aria-label="Höchstnächte" /></td>
                      {["cta", "ctd", "stopSell"].map((n) => (
                        <td key={n}>
                          <select name={`${n}${i}`} defaultValue="" aria-label={n}><option value="">–</option><option value="yes">ja</option><option value="no">nein</option></select>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rowCount < MAX_ROWS ? <a className="small" href={`?from=${from}&rows=${rowCount + 2}`}>+ weitere Zeilen</a> : null}
            <Weekdays />
            <button className="btn">Alle speichern</button>
          </form>

          <form action={saveBlock} className="card stack">
            <h3>Zimmer sperren / freigeben</h3>
            <input type="hidden" name="hotelId" value={hotel.id} />
            <input type="hidden" name="viewFrom" value={from} />
            <div>
              <label>Zimmertyp</label>
              <select name="roomTypeId" required>
                {cal.roomTypes.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.roomCount})</option>)}
              </select>
            </div>
            <div className="inline-form">
              <div><label>Von</label><input type="date" name="from" defaultValue={from} required /></div>
              <div><label>Bis (inkl.)</label><input type="date" name="to" defaultValue={from} required /></div>
            </div>
            <Weekdays />
            <div><label>Anzahl gesperrte Zimmer (0 = freigeben)</label><input name="blocked" type="number" min={0} defaultValue={1} required /></div>
            <button className="btn">Speichern</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
