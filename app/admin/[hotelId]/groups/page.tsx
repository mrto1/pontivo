import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { createGroup, GroupError, listGroups } from "@/src/services/groups";
import { formatDay } from "@/src/i18n/dict";
import { ZodError } from "zod";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";

const STATUS = { active: "Block aktiv", released: "Block freigegeben", cancelled: "abgesagt" } as const;

async function create(f: FormData) {
  "use server";
  const c = await requireHotelModule("groups", s(f, "hotelId"), "staff", "groups");
  let to: string;
  try {
    const g = await createGroup(c.hotel, { name: s(f, "name"), company: s(f, "company"), contactName: s(f, "contactName"), contactEmail: s(f, "contactEmail"), street: s(f, "street"), zip: s(f, "zip"), city: s(f, "city"), arrival: s(f, "arrival"), departure: s(f, "departure"), releaseOn: s(f, "releaseOn") }, c.actor);
    to = `/admin/${c.hotel.id}/groups/${g.id}`;
  } catch (e) {
    const msg = e instanceof GroupError ? e.message : e instanceof ZodError ? e.issues[0]?.message ?? "Eingabe prüfen" : null;
    if (!msg) throw e;
    to = `/admin/${c.hotel.id}/groups?msg=${encodeURIComponent(msg)}`;
  }
  redirect(to);
}

export default async function Groups({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("groups", hotelId, "staff", "groups");
  const list = await listGroups(hotel.id);
  return (
    <div className="stack">
      <h1 className="sr-only">Gruppen</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <section className="card">
        {list.length ? (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Gruppe</th><th>Zeitraum</th><th>Teilnehmer</th><th>Freie Blockzimmer</th><th>Freigabe</th><th>Status</th></tr></thead>
            <tbody>{list.map((g) => (
              <tr key={g.id}>
                <td><a href={`/admin/${hotel.id}/groups/${g.id}`}><strong>{g.name}</strong></a>{g.company ? <div className="small muted">{g.company}</div> : null}</td>
                <td className="small">{formatDay(g.arrival, "de")} – {formatDay(g.departure, "de")}</td>
                <td>{g.members}</td><td>{g.blockLeft}</td>
                <td className="small">{g.releaseOn ? formatDay(g.releaseOn, "de") : "–"}</td>
                <td><span className={`badge ${g.status === "active" ? "" : "warn"}`}>{STATUS[g.status]}</span></td>
              </tr>))}</tbody>
          </table></div>
        ) : <p className="muted small">Noch keine Gruppen. Legen Sie unten die erste an.</p>}
      </section>
      <section className="card stack">
        <h2>Neue Gruppe</h2>
        <form action={create} className="stack">
          <input type="hidden" name="hotelId" value={hotel.id} />
          <div className="form-grid">
            <div><label htmlFor="f2a191">Name der Gruppe</label><input id="f2a191" name="name" required placeholder="z. B. Firmenanlass Muster AG" /></div>
            <div><label htmlFor="f2a192">Anreise</label><input id="f2a192" name="arrival" type="date" required /></div>
            <div><label htmlFor="f2a193">Abreise</label><input id="f2a193" name="departure" type="date" required /></div>
            <div><label htmlFor="f2a194">Freigabefrist (optional)</label><input id="f2a194" name="releaseOn" type="date" /><p className="small muted">Ab diesem Tag gehen unbelegte Blockzimmer automatisch zurück in den Verkauf.</p></div>
            <div><label htmlFor="f2a195">Firma (für die Rechnung)</label><input id="f2a195" name="company" /></div>
            <div><label htmlFor="f2a196">Kontaktperson</label><input id="f2a196" name="contactName" /></div>
            <div><label htmlFor="f2a197">E-Mail Kontakt</label><input id="f2a197" name="contactEmail" type="email" /></div>
            <div><label htmlFor="f2a198">Strasse und Nr.</label><input id="f2a198" name="street" /></div>
            <div><label htmlFor="f2a199">PLZ</label><input id="f2a199" name="zip" /></div>
            <div><label htmlFor="f2a1910">Ort</label><input id="f2a1910" name="city" /></div>
          </div>
          <div><button className="btn">Gruppe anlegen</button></div>
        </form>
      </section>
    </div>
  );
}
