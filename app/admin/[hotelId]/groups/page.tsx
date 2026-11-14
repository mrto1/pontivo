import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { createGroup, GroupError, listGroups } from "@/src/services/groups";
import { formatDay } from "@/src/i18n/dict";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const STATUS = { active: "Block aktiv", released: "Block freigegeben", cancelled: "abgesagt" } as const;

async function create(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "staff", "groups");
  await requireModule(c.hotel.id, "groups");
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
  const { hotel } = await requireHotel(hotelId, "staff", "groups");
  await requireModule(hotel.id, "groups");
  const list = await listGroups(hotel.id);
  return (
    <div className="stack">
      <h1>Gruppen</h1>
      {sp.msg ? <p className="notice warn">{sp.msg}</p> : null}
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
        ) : <p className="muted small">Noch keine Gruppen.</p>}
      </section>
      <section className="card stack">
        <h2>Neue Gruppe</h2>
        <form action={create} className="stack">
          <input type="hidden" name="hotelId" value={hotel.id} />
          <div className="form-grid">
            <div><label>Name der Gruppe</label><input name="name" required placeholder="z. B. Firmenanlass Muster AG" /></div>
            <div><label>Anreise</label><input name="arrival" type="date" required /></div>
            <div><label>Abreise</label><input name="departure" type="date" required /></div>
            <div><label>Freigabefrist (optional)</label><input name="releaseOn" type="date" /><p className="small muted">Ab diesem Tag gehen unbelegte Blockzimmer automatisch zurück in den Verkauf.</p></div>
            <div><label>Firma (für die Rechnung)</label><input name="company" /></div>
            <div><label>Kontaktperson</label><input name="contactName" /></div>
            <div><label>E-Mail Kontakt</label><input name="contactEmail" type="email" /></div>
            <div><label>Strasse und Nr.</label><input name="street" /></div>
            <div><label>PLZ</label><input name="zip" /></div>
            <div><label>Ort</label><input name="city" /></div>
          </div>
          <div><button className="btn">Gruppe anlegen</button></div>
        </form>
      </section>
    </div>
  );
}
