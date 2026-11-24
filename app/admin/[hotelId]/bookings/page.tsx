import Link from "next/link";
import { Notice } from "@/components/admin/Notice";
import { InfoTip } from "@/components/admin/InfoTip";
import { DrawerKeys } from "@/components/admin/DrawerKeys";
import { DownloadLink } from "@/components/admin/DownloadLink";
import { NewBookingForm } from "@/components/admin/NewBookingForm";
import { createBookingAction } from "./new-booking-action";
import { SeenMark } from "@/components/admin/SeenMark";
import { requireHotel } from "@/src/auth/guard";
import { listBookings } from "@/src/services/admin-bookings";
import { formatChf } from "@/src/domain/money";
import { isDay, todayIn } from "@/src/domain/dates";
import { atLeast } from "@/src/auth/session";

export const dynamic = "force-dynamic";

const STATUS = ["", "hold", "confirmed", "expired", "cancelled", "no_show"];
const SOURCE = ["", "direct", "booking_com", "expedia", "airbnb", "other_ota", "admin"];

export default async function Bookings({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "staff", "bookings");
  const f = {
    from: sp.from && isDay(sp.from) ? sp.from : undefined,
    to: sp.to && isDay(sp.to) ? sp.to : undefined,
    status: STATUS.includes(sp.status ?? "") ? sp.status || undefined : undefined,
    source: SOURCE.includes(sp.source ?? "") ? sp.source || undefined : undefined,
  };
  const list = await listBookings(hotel.id, f);
  const base = `/admin/${hotel.id}/bookings`;
  const neu = sp.neu === "1";
  return (
    <div className="stack">
      <SeenMark hotelId={hotel.id} kind="bookings" />
      <h1 className="sr-only">Buchungen</h1>
      {sp.msg && !neu ? <Notice text={sp.msg} /> : null}
      <div className="bk-head">
        <Link className="btn" href={`${base}?neu=1`} scroll={false}>+ Buchung erfassen</Link>
      </div>
      <form className="card bk-filter" method="get">
        <div><label htmlFor="f71ca1">Anreise ab</label><input id="f71ca1" type="date" name="from" defaultValue={f.from} /></div>
        <div><label htmlFor="f71ca2">Anreise bis</label><input id="f71ca2" type="date" name="to" defaultValue={f.to} /></div>
        <div><label htmlFor="f71ca3">Status</label><select id="f71ca3" name="status" defaultValue={f.status ?? ""}>{STATUS.map((s) => <option key={s} value={s}>{s || "alle"}</option>)}</select></div>
        <div><label htmlFor="f71ca4">Quelle</label><select id="f71ca4" name="source" defaultValue={f.source ?? ""}>{SOURCE.map((s) => <option key={s} value={s}>{s || "alle"}</option>)}</select></div>
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
      {atLeast(role, "owner") ? <div className="dl-row"><DownloadLink href={`/admin/${hotel.id}/berichte`}>Abrechnung exportieren</DownloadLink></div> : null}

      {neu ? (
        <div className="drawer-wrap">
          <Link className="drawer-backdrop" href={base} scroll={false} aria-label="Schliessen" tabIndex={-1} />
          <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabIndex={-1}>
            <header className="drawer-head">
              <h2 id="drawer-title">Buchung erfassen<InfoTip>Für Buchungen per Telefon, E-Mail oder am Empfang. Der Gast bezahlt vor Ort; Preis und Kurtaxe kommen aus dem Kalender. Die Verfügbarkeit wird sofort an die Buchungsportale gemeldet.</InfoTip></h2>
              <Link className="drawer-close" href={base} scroll={false} aria-label="Schliessen">✕</Link>
            </header>
            <div className="drawer-body stack">
              {sp.msg ? <Notice text={sp.msg} /> : null}
              <NewBookingForm hotel={hotel} sp={sp} action={createBookingAction} cancelHref={base} />
            </div>
          </aside>
          <DrawerKeys closeHref={base} />
        </div>
      ) : null}
    </div>
  );
}
