import { PeriodNav } from "@/components/admin/PeriodNav";
import { DownloadLink } from "@/components/admin/DownloadLink";
import { InfoTip } from "@/components/admin/InfoTip";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { hestaMonth } from "@/src/services/hesta";
import { countryName } from "@/src/domain/countries";
import { shiftMonth } from "@/src/services/overview";
import { todayIn } from "@/src/domain/dates";

export const dynamic = "force-dynamic";
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export default async function Hesta({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("statistics", hotelId, "staff", "statistics");
  const thisMonth = todayIn(hotel.timezone).slice(0, 7);
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : shiftMonth(thisMonth, -1);
  const r = await hestaMonth(hotel.id, month);
  const o = r.occupancy;
  const tot = r.rows.reduce((a, x) => ({ arrivals: a.arrivals + x.arrivals, nights: a.nights + x.nights }), { arrivals: 0, nights: 0 });
  return (
    <div className="stack">
      <h1 className="sr-only">Beherbergungsstatistik (HESTA)</h1>
      <div><InfoTip label="Worum geht es hier?">Zahlen für die Meldung an das Bundesamt für Statistik. Sie tragen sie im Portal des BFS (eHESTA) ein; eine automatische Übermittlung gibt es noch nicht. Herkunftsland = Nationalität aus der Gästemeldung; Personen ohne Meldung stehen unter «Land unbekannt».</InfoTip></div>
      <PeriodNav prev={`?month=${shiftMonth(month, -1)}`} next={month < thisMonth ? `?month=${shiftMonth(month, 1)}` : undefined} todayHref="?" todayActive={month === shiftMonth(thisMonth, -1)} todayLabel="Letzter Monat" prevLabel="Vormonat" nextLabel="Folgemonat" jump={{ kind: "month", value: month, param: "month" }} />
      <section className="card stack">
        <h2>Angebot und Belegung</h2>
        <div className="inline-form">
          <div><span className="muted small">Zimmer</span><br /><strong>{o.rooms}</strong></div>
          <div><span className="muted small">Betten (Höchstbelegung)</span><br /><strong>{o.beds}</strong></div>
          <div><span className="muted small">Verfügbare Zimmernächte</span><br /><strong>{o.availableRoomNights}</strong></div>
          <div><span className="muted small">Belegte Zimmernächte</span><br /><strong>{o.occupiedRoomNights}</strong></div>
          <div><span className="muted small">Zimmerauslastung</span><br /><strong>{o.roomOccupancyPct.toLocaleString("de-CH")} %</strong></div>
        </div>
      </section>
      <section className="card stack">
        <h2>Ankünfte und Logiernächte nach Herkunftsland</h2>
        {r.rows.length ? (
          <table className="table">
            <thead><tr><th>Herkunftsland</th><th>Ankünfte</th><th>Logiernächte</th></tr></thead>
            <tbody>
              {r.rows.map((x) => <tr key={x.country ?? "?"}><td>{x.country ? `${countryName(x.country)} (${x.country})` : "Land unbekannt"}</td><td>{x.arrivals}</td><td>{x.nights}</td></tr>)}
              <tr><td><strong>Total</strong></td><td><strong>{tot.arrivals}</strong></td><td><strong>{tot.nights}</strong></td></tr>
            </tbody>
          </table>
        ) : <p className="muted">Keine Gäste in diesem Monat.</p>}
        <div><DownloadLink href={`/admin/${hotel.id}/statistics/hesta/csv?month=${month}`}>Als CSV laden</DownloadLink></div>
      </section>
    </div>
  );
}
