import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { ResourceError, cancelResourceBooking, createResourceBooking, listDay, listResources } from "@/src/services/resources";
import { hhmm } from "@/src/domain/resources";
import { formatChf } from "@/src/domain/money";
import { formatDay } from "@/src/i18n/dict";
import { addDays, todayIn } from "@/src/domain/dates";
import { PeriodNav } from "@/components/admin/PeriodNav";
import { s } from "@/src/lib/form";
import { hotelAction, userErrorText, type HotelCtx } from "@/src/lib/hotel-action";

export const dynamic = "force-dynamic";
const run = (f: FormData, fail: string, fn: (c: HotelCtx) => Promise<string>) =>
  hotelAction(f, { page: "resources", module: "resources", area: "resources", fail, keep: { day: s(f, "day") } }, fn);

async function book(f: FormData) {
  "use server";
  await run(f, "Nicht gebucht", async (c) => {
    await createResourceBooking(c.hotel.id, { resourceId: s(f, "resourceId"), day: s(f, "day"), start: s(f, "start"), end: s(f, "end"), persons: Number(s(f, "persons")), guestName: s(f, "guestName"), bookingReference: s(f, "reference"), note: s(f, "note") }, c.actor);
    return "Gebucht.";
  });
}
async function cancel(f: FormData) {
  "use server";
  await run(f, "Nicht storniert", async (c) => { await cancelResourceBooking(c.hotel.id, s(f, "id"), c.actor); return "Storniert."; });
}

export default async function ResourcesPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotelModule("resources", hotelId, "staff", "resources");
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
          <div><label htmlFor="f001f1">Angebot</label><select id="f001f1" name="resourceId">{active.map((r) => <option key={r.id} value={r.id}>{r.name} ({hhmm(r.openFrom)}–{hhmm(r.openTo)}, {r.slotMinutes} Min.)</option>)}</select></div>
          <div><label htmlFor="f001f2">Von (HH:MM)</label><input id="f001f2" name="start" placeholder="14:00" required /></div>
          <div><label htmlFor="f001f3">Bis (HH:MM)</label><input id="f001f3" name="end" placeholder="15:00" required /></div>
          <div><label htmlFor="f001f4">Personen</label><input id="f001f4" name="persons" type="number" min={1} defaultValue={1} required /></div>
          <div><label htmlFor="f001f5">Buchungsnummer (Hausgast, Preis kommt aufs Zimmer – sonst leer lassen)</label><input id="f001f5" name="reference" /></div>
          <div><label htmlFor="f001f6">Name (bei Hausgast optional)</label><input id="f001f6" name="guestName" /></div>
          <div><label htmlFor="f001f7">Notiz</label><input id="f001f7" name="note" /></div>
          <div><button className="btn">Buchen</button></div>
        </form>
      ) : null}
      {canEdit ? <p className="small muted">Angebote, Plätze und Preise ändern Sie unter <a href={`/admin/${hotel.id}/resources/angebote`}>Einstellungen → Angebote vor Ort</a>.</p> : null}
    </div>
  );
}
