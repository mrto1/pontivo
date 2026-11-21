import { Notice } from "@/components/admin/Notice";
import { PeriodNav } from "@/components/admin/PeriodNav";
import { FormSwitch } from "@/components/admin/FormSwitch";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosError, listTables } from "@/src/services/pos";
import { assignTable, createReservation, getSettings, reservationsOfDay, saveSettings, setReservationStatus } from "@/src/services/reservations";
import { addDays, isDay, todayIn } from "@/src/domain/dates";
import { coversAt } from "@/src/domain/reservations";
import { formatDay } from "@/src/i18n/dict";
import { atLeast } from "@/src/domain/roles";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const here = (h: string, day: string, msg: string) => redirect(`/mypontivo/${h}/restaurant/reservierungen?day=${day}&msg=${encodeURIComponent(msg)}`);
const STATUS = { confirmed: "bestätigt", seated: "am Tisch", cancelled: "storniert", noshow: "nicht erschienen" } as const;

async function guard(f: FormData, manager = false) {
  const c = manager ? await requireHotel(s(f, "hotelId"), "manager") : await requireHotel(s(f, "hotelId"), "staff", "reservations");
  await requireModule(c.hotel.id, "pos");
  return c;
}
async function create(f: FormData) {
  "use server";
  const c = await guard(f);
  const day = s(f, "day");
  try { await createReservation(c.hotel, { day, time: s(f, "time"), party: Number(s(f, "party")), name: s(f, "name"), phone: s(f, "phone"), email: s(f, "email"), note: s(f, "note"), tableId: s(f, "tableId") || null }, "admin", c.actor); }
  catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, isDay(day) ? day : todayIn(c.hotel.timezone), `Nicht gespeichert: ${e.message}`); }
  here(c.hotel.id, day, "Reservierung gespeichert.");
}
async function status(f: FormData) {
  "use server";
  const c = await guard(f);
  const st = s(f, "status") as keyof typeof STATUS;
  if (!(st in STATUS)) return here(c.hotel.id, s(f, "day"), "Status ungültig.");
  try { await setReservationStatus(c.hotel.id, s(f, "id"), st, c.actor); } catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, s(f, "day"), e.message); }
  here(c.hotel.id, s(f, "day"), "Gespeichert.");
}
async function table(f: FormData) {
  "use server";
  const c = await guard(f);
  try { await assignTable(c.hotel.id, s(f, "id"), s(f, "tableId") || null, c.actor); } catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, s(f, "day"), `Nicht zugewiesen: ${e.message}`); }
  here(c.hotel.id, s(f, "day"), "Tisch zugewiesen.");
}
async function settings(f: FormData) {
  "use server";
  const c = await guard(f, true);
  const windows = [1, 2].flatMap((n) => (s(f, `from${n}`) && s(f, `to${n}`) ? [{ from: s(f, `from${n}`), to: s(f, `to${n}`) }] : []));
  try {
    await saveSettings(c.hotel.id, { onlineEnabled: f.get("onlineEnabled") === "on", windows, durationMin: Number(s(f, "durationMin")), maxParty: Number(s(f, "maxParty")), capacity: Number(s(f, "capacity")), leadHours: Number(s(f, "leadHours")), horizonDays: Number(s(f, "horizonDays")) }, c.actor);
  } catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, s(f, "day"), `Einstellungen nicht gespeichert: ${e.message}`); }
  here(c.hotel.id, s(f, "day"), "Einstellungen gespeichert.");
}

/** Tischreservierungen (SPEC 19.49 Etappe C): Liste je Tag, Tisch zuweisen, Status, neue Reservierung, Online-Einstellungen */
export default async function ReservationsPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "staff", "reservations");
  await requireModule(hotel.id, "pos");
  const today = todayIn(hotel.timezone);
  const day = sp.day && isDay(sp.day) ? sp.day : today;
  const [list, tables, cfg] = await Promise.all([reservationsOfDay(hotel.id, day), listTables(hotel.id), getSettings(hotel.id)]);
  const tname = new Map(tables.map((t) => [t.id, t.name]));
  const live = list.filter((r) => r.status === "confirmed" || r.status === "seated");
  const guests = live.reduce((a, r) => a + r.party, 0);
  const peak = Math.max(0, ...live.map((r) => coversAt(list, r.time, cfg.durationMin)));
  const manager = atLeast(role, "manager");
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  const D = <input type="hidden" name="day" value={day} />;
  const publicUrl = `/h/${hotel.slug}/${hotel.defaultLanguage}/tisch`;
  return (
    <div className="stack">
      <h1>Tischreservierungen</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <PeriodNav prev={`?day=${addDays(day, -1)}`} next={`?day=${addDays(day, 1)}`} todayHref="?" todayActive={day === today} prevLabel="Vortag" nextLabel="Folgetag" jump={{ value: day, param: "day" }}>
        <span className="small muted">{formatDay(day, "de")} · {live.length} Reservierungen, {guests} Gäste{peak ? `, gleichzeitig bis zu ${peak} von ${cfg.capacity} Plätzen` : ""}</span>
      </PeriodNav>
      <section className="card">
        {list.length ? (
          <table className="table" data-testid="res-list"><thead><tr><th>Zeit</th><th>Pers.</th><th>Gast</th><th>Tisch</th><th>Status</th><th /></tr></thead><tbody>
            {list.map((r) => (
              <tr key={r.id} className={r.status === "cancelled" || r.status === "noshow" ? "muted" : undefined}>
                <td>{r.time}</td><td>{r.party}</td>
                <td>{r.name}{r.source === "online" ? " (online)" : ""}<div className="small muted">{[r.phone, r.email, r.note].filter(Boolean).join(" · ")}</div></td>
                <td><form action={table} className="inline-form">{H}{D}<input type="hidden" name="id" value={r.id} />
                  <select name="tableId" defaultValue={r.tableId ?? ""} aria-label={`Tisch ${r.name}`}><option value="">–</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.seats})</option>)}</select> <button className="btn secondary small">Setzen</button></form>
                  {r.tableId ? <span className="small muted">{tname.get(r.tableId)}</span> : null}</td>
                <td>{STATUS[r.status]}</td>
                <td>{(["seated", "noshow", "cancelled"] as const).filter((x) => x !== r.status).map((x) => (
                  <form key={x} action={status} style={{ display: "inline" }}>{H}{D}<input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value={x} /><button className="btn secondary small">{x === "seated" ? "Am Tisch" : x === "noshow" ? "Nicht erschienen" : "Stornieren"}</button></form>
                ))}</td>
              </tr>
            ))}
          </tbody></table>
        ) : <p className="muted">Keine Reservierungen an diesem Tag.</p>}
      </section>
      <form action={create} className="card stack">
        {H}{D}
        <h2>Neue Reservierung</h2>
        <div className="inline-form">
          <div><label htmlFor="time">Zeit</label><input id="time" name="time" type="time" step={900} required /></div>
          <div><label htmlFor="party">Personen</label><input id="party" name="party" type="number" min={1} max={50} defaultValue={2} required style={{ width: 80 }} /></div>
          <div><label htmlFor="tableId">Tisch</label><select id="tableId" name="tableId"><option value="">noch offen</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.seats})</option>)}</select></div>
        </div>
        <div><label htmlFor="name">Name</label><input id="name" name="name" required maxLength={80} /></div>
        <div className="inline-form">
          <div><label htmlFor="phone">Telefon</label><input id="phone" name="phone" maxLength={40} /></div>
          <div><label htmlFor="email">E-Mail (für Bestätigung)</label><input id="email" name="email" type="email" maxLength={200} /></div>
        </div>
        <div><label htmlFor="note">Notiz</label><input id="note" name="note" maxLength={300} placeholder="Kinderstuhl, Geburtstag …" /></div>
        <div><button className="btn">Speichern</button></div>
      </form>
      {manager ? (
        <form action={settings} className="card stack" id="online">
          {H}{D}
          <h2>Online-Reservierung für Gäste</h2>
          <FormSwitch name="onlineEnabled" defaultOn={cfg.onlineEnabled} label="Gäste können online reservieren" hint={<>Formular unter <a href={publicUrl}>{publicUrl}</a> (auf Ihrer Hotel-Website verlinken).</>} />
          <p className="small muted">Zeitfenster, in denen Gäste einen Tisch beginnen können (im Raster von 30 Minuten):</p>
          <div className="inline-form">
            {[1, 2].map((n) => { const w = cfg.windows[n - 1]; return (
              <div key={n} className="inline-form"><label htmlFor={`from${n}`}>Fenster {n} von</label><input id={`from${n}`} name={`from${n}`} type="time" defaultValue={w?.from ?? ""} /><label htmlFor={`to${n}`}>bis</label><input id={`to${n}`} name={`to${n}`} type="time" defaultValue={w?.to ?? ""} /></div>
            ); })}
          </div>
          <div className="inline-form">
            <div><label htmlFor="durationMin">Dauer (Min.)</label><input id="durationMin" name="durationMin" type="number" min={30} max={480} defaultValue={cfg.durationMin} style={{ width: 90 }} /></div>
            <div><label htmlFor="capacity">Plätze online</label><input id="capacity" name="capacity" type="number" min={1} max={1000} defaultValue={cfg.capacity} style={{ width: 90 }} /></div>
            <div><label htmlFor="maxParty">Grösste Gruppe</label><input id="maxParty" name="maxParty" type="number" min={1} max={50} defaultValue={cfg.maxParty} style={{ width: 90 }} /></div>
            <div><label htmlFor="leadHours">Vorlauf (Std.)</label><input id="leadHours" name="leadHours" type="number" min={0} max={168} defaultValue={cfg.leadHours} style={{ width: 90 }} /></div>
            <div><label htmlFor="horizonDays">Vorschau (Tage)</label><input id="horizonDays" name="horizonDays" type="number" min={1} max={365} defaultValue={cfg.horizonDays} style={{ width: 90 }} /></div>
          </div>
          <div><button className="btn">Speichern</button></div>
        </form>
      ) : null}
    </div>
  );
}
