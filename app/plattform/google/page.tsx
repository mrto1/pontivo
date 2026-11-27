import { requirePlatformAdmin } from "@/src/auth/guard";
import { actionsCenterFeeds, googleRequests } from "@/src/services/google";
import { googlePartner, googleStatus } from "../actions";
import { env } from "@/src/env";
import { googleSendEnabled } from "@/src/integrations/google-hotels/client";
import { partnerOverview } from "@/src/services/google-hotels";
import { Flash, PageHead } from "../Flash";

export const dynamic = "force-dynamic";
const TO = "/plattform/google";
const LABEL = { off: "aus", requested: "angefragt", active: "aktiv" } as const;

/** Google (SPEC 19.67): Anfragen für kostenlose Buchungslinks und Feeds für das Actions Center */
export default async function GooglePlatform({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const [list, feeds, partners] = await Promise.all([googleRequests(), actionsCenterFeeds(), partnerOverview()]);
  const e = env();
  const token = e.GOOGLE_HOTELS_FEED_TOKEN;
  const urls = token ? [["Hotelliste", `${e.APP_BASE_URL}/api/google/hotel-list?token=${token}`], ["Landingpage-Datei", `${e.APP_BASE_URL}/api/google/landing-pages?token=${token}`]] : [];
  return (
    <div className="stack gap24">
      <PageHead title="Google">Unterkünfte fragen kostenlose Buchungslinks an: in Channex den Kanal «Google Hotel Search» für die Property anlegen, Zimmer und Tarife zuordnen und hier auf «aktiv» stellen. Restaurants mit «Reservieren/Bestellen über Google» stehen in den Feeds für das Actions Center (täglich vollständig hochladen, sobald Pontivo Partner ist).</PageHead>
      <Flash sp={sp} />
      <section className="card stack" data-testid="google-partner">
        <h2 className="m0">Google Hotelpreise: eigene Partner-Anbindung</h2>
        <p className="small muted m0">Pontivo meldet Zimmer, Tarife, Bestand, Preise, Einschränkungen und Kurtaxe selbst an Google (statt über Channex). Aufnehmen kann man nur Betriebe, die alle Voraussetzungen erfüllen. Gesendet wird erst, wenn der Vertrag mit Google steht, die Server-IPs im Hotel Center freigegeben sind und die Umgebungswerte gesetzt sind.</p>
        <ul className="small m0">
          <li>Partner-Schlüssel: {e.GOOGLE_HOTELS_PARTNER_KEY ? "gesetzt" : "fehlt"}</li>
          <li>Senden: {googleSendEnabled() ? "eingeschaltet" : "aus (Trockenlauf: Nachrichten lassen sich unten ansehen)"}</li>
          <li>Abruf-Adressen für das Hotel Center: {token ? "" : "fehlen (GOOGLE_HOTELS_FEED_TOKEN setzen)"}</li>
        </ul>
        {urls.length ? <ul className="small">{urls.map(([n, u]) => <li key={n}>{n}: <code>{u}</code></li>)}</ul> : null}
        {partners.length ? (
          <div className="scroll-x"><table className="table" data-testid="google-partners"><thead><tr><th>Betrieb</th><th>Voraussetzungen</th><th>Letzte Sendung</th><th /></tr></thead><tbody>
            {partners.map((r) => (
              <tr key={r.hotelId}>
                <td><a href={`/admin/${r.hotelId}/google`}>{r.name}</a>{r.partner ? <span className="small muted"> · im Feed</span> : null}</td>
                <td className="small">{r.missing.length ? r.missing.join("; ") : "erfüllt"}</td>
                <td className="small">{r.lastSentAt ? r.lastSentAt.toLocaleString("de-CH") : "–"}{r.lastError ? <span className="notice warn"> {r.lastError}</span> : null}</td>
                <td className="nowrap">
                  <form action={googlePartner} className="d-inline"><input type="hidden" name="to" value={TO} /><input type="hidden" name="hotelId" value={r.hotelId} /><input type="hidden" name="on" value={r.partner ? "0" : "1"} /><button className="btn secondary small" disabled={!r.partner && r.missing.length > 0}>{r.partner ? "Herausnehmen" : "Aufnehmen"}</button></form>
                  {r.missing.length === 0 ? (["property", "taxes", "inventory", "rate", "availability"] as const).map((k) => <a key={k} className="small" href={`${TO}/nachrichten/${r.hotelId}/${k}`} download> {k}</a>) : null}
                </td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <p className="muted">Noch keine Unterkünfte live.</p>}
      </section>
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
