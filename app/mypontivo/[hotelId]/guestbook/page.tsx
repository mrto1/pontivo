import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { allTags, kartei, REGULAR_VISITS } from "@/src/services/guest-notes";
import { moduleRows } from "@/src/services/modules";
import { isOn } from "@/src/domain/modules";
import { formatDay } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";

/** Kartei (SPEC 17.2): Gäste mit Aufenthalten, Tags und Notizen, durchsuchbar. Die Notiz wird bei der Buchung bearbeitet. */
export default async function Guestbook({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "staff", "guestbook");
  await requireModule(hotel.id, "guestnotes");
  const q = (sp.q ?? "").slice(0, 80);
  const tag = (sp.tag ?? "").slice(0, 24);
  const [rows, tags, mods] = await Promise.all([kartei(hotel.id, q, tag), allTags(hotel.id), moduleRows(hotel.id)]);
  const dining = isOn(mods, "restaurant");
  const lodging = hotel.propertyType !== "restaurant";
  return (
    <div className="stack">
      <h1>Kartei</h1>
      <form method="get" className="inline-form">
        <input name="q" defaultValue={q} placeholder="Name, E-Mail, Tag oder Notiz suchen" />
        {tags.length ? (
          <select name="tag" defaultValue={tag}><option value="">alle Tags</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        ) : null}
        <button className="btn secondary small">Suchen</button>
      </form>
      <section className="card">
        {rows.length ? (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Gast</th>{lodging ? <><th>Aufenthalte</th><th>Letzte Anreise</th></> : null}{dining ? <><th>Restaurant</th><th>Letzter Besuch</th></> : null}<th>Tags</th><th>Notiz</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.email}>
                  <td><strong>{r.name || "–"}</strong><div className="small muted">{r.email}</div></td>
                  {lodging ? <><td>{r.stays}</td><td className="small">{r.lastCheckin ? formatDay(r.lastCheckin, "de") : "–"}</td></> : null}
                  {dining ? <><td>{r.visits}{r.visits >= REGULAR_VISITS ? <> <span className="badge">Stammgast</span></> : null}</td><td className="small">{r.lastVisit ? formatDay(r.lastVisit, "de") : "–"}</td></> : null}
                  <td>{r.tags.map((t) => <span key={t} className="badge" style={{ marginRight: 4 }}>{t}</span>)}</td>
                  <td className="small">{r.note.slice(0, 120)}{r.note.length > 120 ? "…" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <p className="muted small">Keine Treffer.</p>}
      </section>
      <p className="small muted">Notizen und Tags bearbeiten Sie bei der Buchung{dining ? " oder bei der Tischreservierung" : ""} des Gastes. Sie gelten für die E-Mail-Adresse und nur in diesem Betrieb.{dining ? ` Ab ${REGULAR_VISITS} Restaurantbesuchen steht «Stammgast». Allergien nur als kurzer Hinweis für die Küche (z. B. «ohne Nüsse»), keine Gesundheitsangaben.` : ""}</p>
    </div>
  );
}
