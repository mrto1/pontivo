import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { allTags, kartei } from "@/src/services/guest-notes";
import { formatDay } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";

/** Kartei (SPEC 17.2): Gäste mit Aufenthalten, Tags und Notizen, durchsuchbar. Die Notiz wird bei der Buchung bearbeitet. */
export default async function Guestbook({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId);
  await requireModule(hotel.id, "guestnotes");
  const q = (sp.q ?? "").slice(0, 80);
  const tag = (sp.tag ?? "").slice(0, 24);
  const [rows, tags] = await Promise.all([kartei(hotel.id, q, tag), allTags(hotel.id)]);
  return (
    <div className="stack">
      <h1>Gäste-Kartei</h1>
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
            <thead><tr><th>Gast</th><th>Aufenthalte</th><th>Letzte Anreise</th><th>Tags</th><th>Notiz</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.email}>
                  <td><strong>{r.name || "–"}</strong><div className="small muted">{r.email}</div></td>
                  <td>{r.stays}</td>
                  <td className="small">{r.lastCheckin ? formatDay(r.lastCheckin, "de") : "–"}</td>
                  <td>{r.tags.map((t) => <span key={t} className="badge" style={{ marginRight: 4 }}>{t}</span>)}</td>
                  <td className="small">{r.note.slice(0, 120)}{r.note.length > 120 ? "…" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <p className="muted small">Keine Treffer.</p>}
      </section>
      <p className="small muted">Notizen und Tags bearbeiten Sie bei der Buchung des Gastes. Sie gelten für die E-Mail-Adresse und nur in diesem Betrieb.</p>
    </div>
  );
}
