import { PeriodNav } from "@/components/admin/PeriodNav";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { waitlistOfDay } from "@/src/services/reservations";
import { addDays, isDay, todayIn } from "@/src/domain/dates";
import { formatDay } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";

/** Warteliste je Tag (SPEC 19.49 C2, eigene Seite seit SPEC 20.1) */
export default async function WaitlistPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("restaurant", hotelId, "staff", "waitlist");
  const today = todayIn(hotel.timezone);
  const day = sp.day && isDay(sp.day) ? sp.day : today;
  const list = await waitlistOfDay(hotel.id, day);
  return (
    <div className="stack">
      <h1 className="sr-only">Warteliste</h1>
      <PeriodNav prev={`?day=${addDays(day, -1)}`} next={`?day=${addDays(day, 1)}`} todayHref="?" todayActive={day === today} prevLabel="Vortag" nextLabel="Folgetag" jump={{ value: day, param: "day" }}>
        <span className="small muted">{formatDay(day, "de")}</span>
      </PeriodNav>
      <section className="card">
        {list.length ? (
          <table className="table" data-testid="waitlist"><thead><tr><th>Eingetragen</th><th>Gast</th><th>Pers.</th><th>E-Mail</th><th>Status</th></tr></thead><tbody>
            {list.map((w) => <tr key={w.id}><td className="small">{w.createdAt.toLocaleString("de-CH", { timeZone: hotel.timezone })}</td><td>{w.name}</td><td>{w.party}</td><td><a href={`mailto:${w.email}`}>{w.email}</a></td><td>{w.notifiedAt ? "benachrichtigt" : "wartet"}</td></tr>)}
          </tbody></table>
        ) : <p className="muted">Niemand auf der Warteliste.</p>}
        <p className="small muted">Gäste tragen sich online ein, wenn kein Tisch frei ist. Wird ein Platz frei (Storno), bekommen sie einmal eine Mail; wer zuerst bucht, bekommt den Tisch.</p>
      </section>
    </div>
  );
}
