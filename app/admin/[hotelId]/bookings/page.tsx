import { requireHotel } from "@/src/auth/guard";
import { listBookings } from "@/src/services/admin-bookings";
import { formatChf } from "@/src/domain/money";
import { isDay } from "@/src/domain/dates";

export const dynamic = "force-dynamic";

const STATUS = ["", "hold", "confirmed", "expired", "cancelled", "no_show"];
const SOURCE = ["", "direct", "booking_com", "expedia", "airbnb", "other_ota", "admin"];

export default async function Bookings({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "staff", "bookings");
  const f = {
    from: sp.from && isDay(sp.from) ? sp.from : undefined,
    to: sp.to && isDay(sp.to) ? sp.to : undefined,
    status: STATUS.includes(sp.status ?? "") ? sp.status || undefined : undefined,
    source: SOURCE.includes(sp.source ?? "") ? sp.source || undefined : undefined,
  };
  const list = await listBookings(hotel.id, f);
  return (
    <div className="stack">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Buchungen</h1>
        <a className="btn small" href={`/admin/${hotel.id}/bookings/new`}>+ Buchung erfassen</a>
      </div>
      <form className="card inline-form" method="get">
        <div><label>Anreise ab</label><input type="date" name="from" defaultValue={f.from} /></div>
        <div><label>Anreise bis</label><input type="date" name="to" defaultValue={f.to} /></div>
        <div><label>Status</label><select name="status" defaultValue={f.status ?? ""}>{STATUS.map((s) => <option key={s} value={s}>{s || "alle"}</option>)}</select></div>
        <div><label>Quelle</label><select name="source" defaultValue={f.source ?? ""}>{SOURCE.map((s) => <option key={s} value={s}>{s || "alle"}</option>)}</select></div>
        <button className="btn small">Filtern</button>
      </form>
      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>Ref.</th><th>Anreise</th><th>Abreise</th><th>Gast</th><th>Zimmer</th><th>Quelle</th><th>Status</th><th>Total</th></tr></thead>
          <tbody>
            {list.map(({ b, g, rt }) => (
              <tr key={b.id} className={b.overbooked ? "over" : ""}>
                <td><a href={`/admin/${hotel.id}/bookings/${b.id}`}>{b.reference}</a></td>
                <td>{b.checkin}</td>
                <td>{b.checkout}</td>
                <td>{g ? `${g.firstName} ${g.lastName}` : "–"}</td>
                <td>{rt?.name ?? "–"}</td>
                <td>{b.source}</td>
                <td>{b.overbooked ? <span className="badge danger">Überbuchung</span> : null} <span className={`badge ${b.status === "confirmed" ? "" : "warn"}`}>{b.status}</span></td>
                <td>{formatChf(b.totalRappen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length === 0 ? <p className="muted">Keine Buchungen gefunden.</p> : null}
    </div>
  );
}
