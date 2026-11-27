import { requirePlatformAdmin } from "@/src/auth/guard";
import { actionsCenterFeeds, googleRequests } from "@/src/services/google";
import { googleStatus } from "../actions";
import { Flash, PageHead } from "../Flash";

export const dynamic = "force-dynamic";
const TO = "/plattform/google";
const LABEL = { off: "aus", requested: "angefragt", active: "aktiv" } as const;

/** Google (SPEC 19.67): Anfragen für kostenlose Buchungslinks und Feeds für das Actions Center */
export default async function GooglePlatform({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const [list, feeds] = await Promise.all([googleRequests(), actionsCenterFeeds()]);
  return (
    <div className="stack gap24">
      <PageHead title="Google">Unterkünfte fragen kostenlose Buchungslinks an: in Channex den Kanal «Google Hotel Search» für die Property anlegen, Zimmer und Tarife zuordnen und hier auf «aktiv» stellen. Restaurants mit «Reservieren/Bestellen über Google» stehen in den Feeds für das Actions Center (täglich vollständig hochladen, sobald Pontivo Partner ist).</PageHead>
      <Flash sp={sp} />
      <section className="card stack">
        <h2 className="m0">Betriebe</h2>
        {list.length ? (
          <div className="scroll-x"><table className="table" data-testid="google-requests"><thead><tr><th>Betrieb</th><th>Buchungslinks</th><th>Reservieren</th><th>Bestellen</th><th /></tr></thead><tbody>
            {list.map((r) => (
              <tr key={r.hotelId}>
                <td><a href={`/admin/${r.hotelId}/google`}>{r.name}</a></td>
                <td>{LABEL[r.settings.hotelLinks]}{r.settings.requestedAt ? <span className="small muted"> seit {new Date(r.settings.requestedAt).toLocaleDateString("de-CH")}</span> : null}</td>
                <td>{r.settings.reserve ? "ja" : "–"}</td>
                <td>{r.settings.order ? "ja" : "–"}</td>
                <td className="nowrap">
                  {(["active", "off"] as const).filter((s) => s !== r.settings.hotelLinks).map((s) => (
                    <form key={s} action={googleStatus} className="d-inline"><input type="hidden" name="to" value={TO} /><input type="hidden" name="hotelId" value={r.hotelId} /><input type="hidden" name="status" value={s} /><button className="btn secondary small">{s === "active" ? "Aktiv" : "Aus"}</button></form>
                  ))}
                </td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <p className="muted">Noch keine Anfragen.</p>}
      </section>
      <section className="card stack">
        <h2 className="m0">Feeds für das Actions Center</h2>
        <p className="small muted m0">{feeds.count} Betriebe. Dateien im Format JSON mit Beschreibung (fileset descriptor), Namen mit Zeitstempel.</p>
        <ul className="small">
          {["entity", "entity-desc", "action", "action-desc"].map((n) => <li key={n}><a href={`${TO}/feed/${n}`} download>{n}</a></li>)}
        </ul>
      </section>
    </div>
  );
}
