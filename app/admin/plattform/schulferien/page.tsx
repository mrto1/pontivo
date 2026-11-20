import { requirePlatformAdmin } from "@/src/auth/guard";
import { schoolHolidayStats } from "@/src/services/holidays";
import { todayIn } from "@/src/domain/dates";
import { importSchool } from "../actions";
import { Flash, PageHead } from "../Flash";

export const dynamic = "force-dynamic";
const TO = "/admin/plattform/schulferien";

export default async function Schulferien({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const stats = await schoolHolidayStats(todayIn("Europe/Zurich"));
  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHead title="Schulferien importieren">Die Daten stammen von den kantonalen Erziehungsdirektionen und werden hier eingespielt, nicht im Code gepflegt. Je Zeile: <code>Kanton;Name;von;bis</code> (z. B. <code>ZH;Herbstferien;2027-10-02;2027-10-17</code>, Datum auch als TT.MM.JJJJ). Bestehende Einträge (gleicher Kanton, Name und Beginn) werden aktualisiert. Die Betriebe sehen die Ferien ihres Kantons als Vorschlag in der Preisempfehlung.</PageHead>
      <Flash sp={sp} />
      <section className="card stack">
        <form action={importSchool} className="stack">
          <input type="hidden" name="to" value={TO} />
          <textarea name="csv" rows={10} required placeholder="Kanton;Name;von;bis" />
          <div><button className="btn">Importieren</button></div>
        </form>
        <p className="small">{stats.length ? <>Eingespielt (noch nicht vorbei): {stats.map((x) => `${x.canton} ${x.n}`).join(" · ")}</> : "Noch keine Schulferien eingespielt."}</p>
      </section>
    </div>
  );
}
