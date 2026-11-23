import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { ResourceError, cancelResourceBooking, createResourceBooking, listDay, listResources } from "@/src/services/resources";
import { hhmm } from "@/src/domain/resources";
import { formatChf } from "@/src/domain/money";
import { formatDay } from "@/src/i18n/dict";
import { addDays, todayIn } from "@/src/domain/dates";
import { PeriodNav } from "@/components/admin/PeriodNav";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (h: string, day: string, msg: string) => redirect(`/admin/${h}/resources?day=${day}&msg=${encodeURIComponent(msg)}`);

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
      <h1 className="sr-only">Angebote vor Ort</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <PeriodNav prev={`?day=${addDays(day, -1)}`} next={`?day=${addDays(day, 1)}`} todayHref="?" todayActive={day === todayIn(hotel.timezone)} prevLabel="Vortag" nextLabel="Folgetag" jump={{ value: day, param: "day" }} />
      <section className="card">
        <h2>Gebucht am {formatDay(day, "de")}</h2>
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
      {canEdit ? <p className="small muted">Angebote, Plätze und Preise ändern Sie unter <a href={`/admin/${hotel.id}/resources/angebote`}>Einstellungen → Angebote vor Ort</a>.</p> : null}
    </div>
  );
}
