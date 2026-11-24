import { requirePlatformAdmin } from "@/src/auth/guard";
import { platformOverview } from "@/src/services/platform-admin";
import { roleLabel, ROLE_LABEL, type Role } from "@/src/domain/roles";
import { healthByHotel } from "@/src/services/health";
import { HEALTH_LABEL } from "@/src/domain/health";
import { hotelStatus, memberAdd, memberRemove, removeHotel } from "../actions";
import { Flash, PageHead } from "../Flash";

export const dynamic = "force-dynamic";
const TO = "/plattform/betriebe";
const fmt = (d: Date) => d.toLocaleDateString("de-CH");
const STATUS: Record<string, string> = { live: "online", draft: "Entwurf", paused: "pausiert" };

export default async function Betriebe({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const { hotels } = await platformOverview();
  const health = await healthByHotel();
  return (
    <div className="stack gap24">
      <PageHead title={`Betriebe (${hotels.length})`}>Status, Team und Ampel je Betrieb. Löschen ist endgültig und nimmt alle Daten mit (Buchungen, Rechnungen, Gäste, Mails). Zur Bestätigung den Namen eintippen.</PageHead>
      <Flash sp={sp} />
      {hotels.length === 0 ? <p className="muted">Noch keine Betriebe.</p> : null}
      {hotels.map((h) => (
        <article key={h.id} className="card stack">
          <div className="plat-head">
            <div>
              <h3 className="m0"><a href={`/admin/${h.id}`}>{h.name}</a> <span className={`badge${h.status === "live" ? "" : " warn"}`}>{STATUS[h.status] ?? h.status}</span>{health.get(h.id) ? <> <span className={`ampel ampel-${health.get(h.id)!.level}`} title={HEALTH_LABEL[health.get(h.id)!.level]}>{HEALTH_LABEL[health.get(h.id)!.level]}</span></> : null}</h3>
              {health.get(h.id)?.reasons.length ? <ul className="ampel-reasons small">{health.get(h.id)!.reasons.map((r) => <li key={r.text} className={`ampel-${r.level}`}>{r.text}</li>)}</ul> : null}
              <p className="muted small" style={{ margin: "4px 0 0" }}>{h.bookings} Buchungen · {h.invoices} Rechnungen · angelegt {fmt(h.createdAt)}</p>
            </div>
            {h.status === "live" || h.status === "paused" ? (
              <form action={hotelStatus}>
                <input type="hidden" name="to" value={TO} />
                <input type="hidden" name="id" value={h.id} />
                <input type="hidden" name="status" value={h.status === "live" ? "paused" : "live"} />
                <button className="btn secondary small">{h.status === "live" ? "Pausieren" : "Wieder online"}</button>
              </form>
            ) : null}
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <h4 className="plat-label">Team</h4>
            {h.members.length ? (
              <ul className="plat-list">
                {h.members.map((m) => (
                  <li key={m.userId}>
                    <span>{m.email} <span className="muted small">· {roleLabel(m.role as Role)}</span></span>
                    <form action={memberRemove}>
                      <input type="hidden" name="to" value={TO} />
                      <input type="hidden" name="hotelId" value={h.id} /><input type="hidden" name="userId" value={m.userId} />
                      <button className="btn secondary small" title="Mitgliedschaft entfernen">Entfernen</button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : <p className="muted small m0">Noch niemand.</p>}
            <form action={memberAdd} className="form-row">
              <input type="hidden" name="to" value={TO} />
              <input type="hidden" name="hotelId" value={h.id} />
              <div><label htmlFor={`f5e64m1-${h.id}`}>E-Mail</label><input id={`f5e64m1-${h.id}`} name="email" type="email" placeholder="name@beispiel.ch" required /></div>
              <div><label htmlFor={`f5e64m2-${h.id}`}>Rolle</label><select id={`f5e64m2-${h.id}`} name="role">{(Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
              <div><button className="btn small">Hinzufügen</button></div>
            </form>
          </div>

          <details className="plat-danger">
            <summary>Betrieb löschen</summary>
            <form action={removeHotel} className="form-row" style={{ marginTop: 10 }}>
              <input type="hidden" name="to" value={TO} />
              <input type="hidden" name="id" value={h.id} />
              <div><label htmlFor={`f5e64m3-${h.id}`}>Zur Bestätigung den Namen eintippen</label><input id={`f5e64m3-${h.id}`} name="confirm" placeholder={h.name} aria-label={`Namen von ${h.name} zur Bestätigung`} required /></div>
              <div><button className="btn secondary small">Endgültig löschen</button></div>
            </form>
            {h.status === "live" || h.invoices > 0 ? <p className="small muted" style={{ margin: "8px 0 0" }}>Achtung: Rechnungen müssen in der Schweiz 10 Jahre aufbewahrt werden.</p> : null}
          </details>
        </article>
      ))}
    </div>
  );
}
