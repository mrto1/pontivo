import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { ResourceError, cancelResourceBooking, createResourceBooking, listDay, listResources, saveResource } from "@/src/services/resources";
import { hhmm } from "@/src/domain/resources";
import { formatChf } from "@/src/domain/money";
import { todayIn } from "@/src/domain/dates";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (h: string, day: string, msg: string) => redirect(`/admin/${h}/resources?day=${day}&msg=${encodeURIComponent(msg)}`);

async function saveRes(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "resources");
  let msg = "Angebot gespeichert.";
  try {
    await saveResource(c.hotel.id, s(f, "id") || null, {
      name: s(f, "name"), kind: s(f, "kind") as "other", capacity: Number(s(f, "capacity")), slotMinutes: Number(s(f, "slotMinutes")), openFrom: s(f, "openFrom"), openTo: s(f, "openTo"),
      priceRappen: Math.round(Number(s(f, "price").replace(",", ".") || 0) * 100), pricePerPerson: f.get("pricePerPerson") === "on", vatKind: s(f, "vatKind") as "standard", active: f.get("active") === "on",
    }, c.actor);
  } catch (e) {
    if (!(e instanceof ResourceError)) throw e;
    msg = `Nicht gespeichert: ${e.message}`;
  }
  back(c.hotel.id, s(f, "day"), msg);
}
async function book(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "staff", "resources");
  await requireModule(c.hotel.id, "resources");
  let msg = "Gebucht.";
  try {
    await createResourceBooking(c.hotel.id, { resourceId: s(f, "resourceId"), day: s(f, "day"), start: s(f, "start"), end: s(f, "end"), persons: Number(s(f, "persons")), guestName: s(f, "guestName"), bookingReference: s(f, "reference"), note: s(f, "note") }, c.actor);
  } catch (e) {
    if (!(e instanceof ResourceError)) throw e;
    msg = `Nicht gebucht: ${e.message}`;
  }
  back(c.hotel.id, s(f, "day"), msg);
}
async function cancel(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "staff", "resources");
  await requireModule(c.hotel.id, "resources");
  let msg = "Storniert.";
  try {
    await cancelResourceBooking(c.hotel.id, s(f, "id"), c.actor);
  } catch (e) {
    if (!(e instanceof ResourceError)) throw e;
    msg = `Nicht storniert: ${e.message}`;
  }
  back(c.hotel.id, s(f, "day"), msg);
}

const KINDS = { wellness: "Wellness / Sauna", seminar: "Seminarraum (exklusiv)", sport: "Sport (Tennis …)", other: "Anderes" };

export default async function ResourcesPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "staff", "resources");
  await requireModule(hotel.id, "resources");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? sp.day! : todayIn(hotel.timezone);
  const [list, bookingsToday] = await Promise.all([listResources(hotel.id), listDay(hotel.id, day)]);
  const active = list.filter((r) => r.active);
  const canEdit = role === "owner" || role === "manager";
  return (
    <div className="stack">
      <h1>Angebote vor Ort</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      <form className="card"><label htmlFor="day">Tag</label> <input id="day" name="day" type="date" defaultValue={day} /> <button className="btn secondary">Anzeigen</button></form>
      <section className="card">
        <h2>Gebucht am {day}</h2>
        {bookingsToday.length ? (
          <table className="table"><thead><tr><th>Angebot</th><th>Zeit</th><th>Gast</th><th>Personen</th><th>Preis</th><th /></tr></thead><tbody>
            {bookingsToday.map(({ rb, resource }) => (
              <tr key={rb.id}><td>{resource}</td><td>{hhmm(rb.startMin)}–{hhmm(rb.endMin)}</td><td>{rb.guestName}{rb.bookingId ? " (aufs Zimmer)" : ""}</td><td>{rb.persons}</td><td>{formatChf(rb.priceRappen)}</td>
                <td><form action={cancel}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="day" value={day} /><input type="hidden" name="id" value={rb.id} /><button className="btn secondary">Stornieren</button></form></td></tr>
            ))}
          </tbody></table>
        ) : <p className="muted">Keine Buchungen.</p>}
      </section>
      {active.length ? (
        <form action={book} className="card stack">
          <h2>Neu buchen</h2>
          <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="day" value={day} />
          <div><label>Angebot</label><select name="resourceId">{active.map((r) => <option key={r.id} value={r.id}>{r.name} ({hhmm(r.openFrom)}–{hhmm(r.openTo)}, {r.slotMinutes} Min.)</option>)}</select></div>
          <div><label>Von (HH:MM)</label><input name="start" placeholder="14:00" required /></div>
          <div><label>Bis (HH:MM)</label><input name="end" placeholder="15:00" required /></div>
          <div><label>Personen</label><input name="persons" type="number" min={1} defaultValue={1} required /></div>
          <div><label>Buchungsnummer (Hausgast, Preis kommt aufs Zimmer – sonst leer lassen)</label><input name="reference" /></div>
          <div><label>Name (bei Hausgast optional)</label><input name="guestName" /></div>
          <div><label>Notiz</label><input name="note" /></div>
          <div><button className="btn">Buchen</button></div>
        </form>
      ) : null}
      {canEdit ? [...list, null].map((r) => (
        <form key={r?.id ?? "new"} action={saveRes} className="card stack">
          <h2>{r ? `Angebot: ${r.name}` : "Neues Angebot"}</h2>
          <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="day" value={day} />{r ? <input type="hidden" name="id" value={r.id} /> : null}
          <div><label>Name</label><input name="name" defaultValue={r?.name ?? ""} required /></div>
          <div><label>Art</label><select name="kind" defaultValue={r?.kind ?? "wellness"}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label>Plätze pro Zeitfenster</label><input name="capacity" type="number" min={1} defaultValue={r?.capacity ?? 4} /></div>
          <div><label>Länge eines Zeitfensters (Minuten)</label><input name="slotMinutes" type="number" min={15} step={15} defaultValue={r?.slotMinutes ?? 60} /></div>
          <div><label>Geöffnet von</label><input name="openFrom" defaultValue={r ? hhmm(r.openFrom) : "08:00"} /></div>
          <div><label>Geöffnet bis</label><input name="openTo" defaultValue={r ? hhmm(r.openTo) : "20:00"} /></div>
          <div><label>Preis CHF je Zeitfenster</label><input name="price" inputMode="decimal" defaultValue={r ? r.priceRappen / 100 : 0} /></div>
          <label><input type="checkbox" name="pricePerPerson" defaultChecked={r?.pricePerPerson} /> Preis gilt pro Person</label>
          <div><label>MWST</label><select name="vatKind" defaultValue={r?.vatKind ?? "standard"}><option value="standard">Normalsatz</option><option value="stay">Beherbergungssatz</option><option value="none">keine</option></select></div>
          <label><input type="checkbox" name="active" defaultChecked={r?.active ?? true} /> aktiv</label>
          <div><button className="btn">Speichern</button></div>
        </form>
      )) : null}
    </div>
  );
}
