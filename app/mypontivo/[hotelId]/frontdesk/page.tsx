import { PeriodNav } from "@/components/admin/PeriodNav";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { dayLists, type DayRow } from "@/src/services/frontdesk";
import { addDays, isDay, todayIn } from "@/src/domain/dates";
import { formatDay } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";

function List({ title, rows, hotelId, empty }: { title: string; rows: DayRow[]; hotelId: string; empty: string }) {
  return (
    <section className="card stack">
      <h2>{title} ({rows.length})</h2>
      {rows.length ? (
        <div className="scroll-x"><table className="table">
          <thead><tr><th>Gast</th><th>Personen</th><th>Zimmer</th><th>Aufenthalt</th><th>Buchung</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bookingId}>
                <td>{r.guest}{r.guestCheckedOut ? <> <span className="badge">ausgecheckt (Portal)</span></> : null}</td>
                <td>{r.persons}</td>
                <td>{r.rooms.length ? r.rooms.join(", ") : <span className="muted small">{r.typeNames.join(", ")} (nicht zugewiesen)</span>}</td>
                <td className="small">{formatDay(r.checkin, "de")} – {formatDay(r.checkout, "de")}</td>
                <td><a href={`/mypontivo/${hotelId}/bookings/${r.bookingId}`}>{r.reference}</a></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <p className="muted small">{empty}</p>}
    </section>
  );
}

export default async function Heute({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "staff", "frontdesk");
  await requireModule(hotel.id, "frontdesk");
  const today = todayIn(hotel.timezone);
  const day = sp.day && isDay(sp.day) ? sp.day : today;
  const d = await dayLists(hotel.id, day);
  const base = `/mypontivo/${hotel.id}/frontdesk`;
  return (
    <div className="stack">
      <h1>An- & Abreisen{day === today ? "" : ` · ${formatDay(day, "de")}`}</h1>
      <PeriodNav prev={`${base}?day=${addDays(day, -1)}`} next={`${base}?day=${addDays(day, 1)}`} todayHref={base} todayActive={day === today} prevLabel="Vortag" nextLabel="Folgetag" jump={{ value: day, param: "day" }}>
        <a className="btn secondary small" href={`/mypontivo/${hotel.id}/plan`}>Zimmerplan</a>
      </PeriodNav>
      <List title="Anreisen" rows={d.arrivals} hotelId={hotel.id} empty="Keine Anreisen." />
      <List title="Abreisen" rows={d.departures} hotelId={hotel.id} empty="Keine Abreisen." />
      <List title="Im Haus" rows={d.inHouse} hotelId={hotel.id} empty="Niemand im Haus." />
    </div>
  );
}
