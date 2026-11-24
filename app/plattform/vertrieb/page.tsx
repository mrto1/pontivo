import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/src/auth/guard";
import { cockpit, createLead, leadEvents, listLeads, sendLeadMail, setLeadStatus, SalesError, syncLeads, updateLead } from "@/src/services/sales";
import { healthByHotel } from "@/src/services/health";
import { HEALTH_LABEL } from "@/src/domain/health";
import { LEAD_SOURCES, LEAD_SOURCE_LABEL, LEAD_STATUSES, LEAD_STATUS_LABEL, MAIL_TEMPLATES, isDue, type LeadStatus } from "@/src/domain/sales";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

const back = (msg: string, key: "done" | "error" = "done", status?: string) =>
  redirect(`/plattform/vertrieb?${key}=${encodeURIComponent(msg)}${status ? `&status=${encodeURIComponent(status)}` : ""}`);
const f = (d: FormData, k: string) => String(d.get(k) ?? "");

async function guard<T>(fn: () => Promise<T>, ok: string, status?: string) {
  try { await fn(); } catch (e) { if (e instanceof SalesError || e instanceof Error) back(e.message, "error", status); throw e; }
  back(ok, "done", status);
}

async function addLead(d: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  await guard(() => createLead({ name: f(d, "name"), contactName: f(d, "contactName"), email: f(d, "email"), phone: f(d, "phone"), website: f(d, "website"), canton: f(d, "canton"), source: f(d, "source"), notes: f(d, "notes"), nextActionAt: f(d, "next") || null }, `user:${admin.id}`), "Lead angelegt");
}

async function changeStatus(d: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  await guard(() => setLeadStatus(f(d, "id"), f(d, "status"), `user:${admin.id}`), "Status gespeichert", f(d, "filter") || undefined);
}

async function saveLead(d: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  await guard(() => updateLead(f(d, "id"), { notes: f(d, "notes"), nextActionAt: f(d, "next") || null, doNotContact: d.get("dnc") === "on", contactName: f(d, "contactName"), email: f(d, "email"), phone: f(d, "phone") }, `user:${admin.id}`), "Gespeichert", f(d, "filter") || undefined);
}

async function mail(d: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  await guard(() => sendLeadMail(f(d, "id"), f(d, "template"), { extraLine: f(d, "extra"), senderName: admin.name || env().PLATFORM_OPERATOR || "Pontivo" }, `user:${admin.id}`), "Mail eingereiht, wird in der nächsten Minute gesendet", f(d, "filter") || undefined);
}

const fmt = (d: Date) => d.toLocaleDateString("de-CH");

export default async function Vertrieb({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  await syncLeads();
  const [k, leads, health] = await Promise.all([cockpit(), listLeads({ status: sp.status }), healthByHotel()]);
  const filter = sp.status ?? "";
  const withEvents = await Promise.all(leads.map(async (l) => ({ l, events: await leadEvents(l.id, 8) })));
  return (
    <div>
      <div className="stack" style={{ gap: 24 }}>
        <header className="stack" style={{ gap: 6 }}>
          <h1 style={{ margin: 0 }}>Vertriebs-Cockpit</h1>
          <p className="muted small" style={{ margin: 0 }}>Interessenten, Status und persönliche Nachrichten. Selbst registrierte Betriebe erscheinen automatisch; wird ein Betrieb online geschaltet, gilt der Lead als gewonnen. Nachrichten gehen einzeln an eine Person, kein Massenversand.</p>
        </header>
        {sp.done ? <p className="notice">{sp.done}</p> : null}
        {sp.error ? <p className="notice warn">{sp.error}</p> : null}

        <section className="card stack">
          <div className="kv">
            <span className="muted">Offen</span><span><strong>{k.funnel.open}</strong></span>
            <span className="muted">Nächster Schritt fällig</span><span><strong>{k.due}</strong></span>
            <span className="muted">Neu in 7 Tagen</span><span><strong>{k.newThisWeek}</strong></span>
            <span className="muted">Gewonnen / verloren</span><span><strong>{k.funnel.won}</strong> / {k.funnel.lost}{k.funnel.winRate !== null ? ` (${Math.round(k.funnel.winRate * 100)} % gewonnen)` : ""}</span>
          </div>
          <nav className="seg" aria-label="Status filtern">
            <a href="/plattform/vertrieb" className={filter === "" ? "on" : ""}>Alle ({Object.values(k.funnel.counts).reduce((a, b) => a + b, 0)})</a>
            {LEAD_STATUSES.map((s) => <a key={s} href={`/plattform/vertrieb?status=${s}`} className={filter === s ? "on" : ""}>{LEAD_STATUS_LABEL[s]} ({k.funnel.counts[s]})</a>)}
          </nav>
        </section>

        <details className="card">
          <summary><strong>Neuen Lead anlegen</strong></summary>
          <form action={addLead} className="stack" style={{ marginTop: 12, maxWidth: 560 }}>
            <label>Betrieb<input name="name" required /></label>
            <div className="form-row">
              <div><label htmlFor="f57681">Kontaktperson</label><input id="f57681" name="contactName" /></div>
              <div><label htmlFor="f57682">E-Mail</label><input id="f57682" name="email" type="email" /></div>
              <div><label htmlFor="f57683">Telefon</label><input id="f57683" name="phone" /></div>
            </div>
            <div className="form-row">
              <div><label htmlFor="f57684">Website</label><input id="f57684" name="website" placeholder="https://" /></div>
              <div><label htmlFor="f57685">Kanton</label><input id="f57685" name="canton" maxLength={2} placeholder="GR" style={{ width: 70 }} /></div>
              <div><label htmlFor="f57686">Quelle</label><select id="f57686" name="source">{LEAD_SOURCES.map((s) => <option key={s} value={s}>{LEAD_SOURCE_LABEL[s]}</option>)}</select></div>
              <div><label htmlFor="f57687">Nächster Schritt am</label><input id="f57687" name="next" type="date" /></div>
            </div>
            <label>Notizen<textarea name="notes" rows={2} /></label>
            <div><button className="btn">Anlegen</button></div>
          </form>
        </details>

        {withEvents.length === 0 ? <p className="muted">Keine Leads in dieser Ansicht.</p> : withEvents.map(({ l, events }) => {
          const h = l.hotelId ? health.get(l.hotelId) : undefined;
          return (
            <article key={l.id} className="card stack" id={`lead-${l.id}`}>
              <div className="plat-head">
                <div>
                  <h3 style={{ margin: 0 }}>{l.name} <span className="badge">{LEAD_STATUS_LABEL[l.status as LeadStatus]}</span>
                    {h ? <> <span className={`ampel ampel-${h.level}`}>{HEALTH_LABEL[h.level]}</span></> : null}
                    {isDue({ status: l.status as LeadStatus, nextActionAt: l.nextActionAt }, k.today) ? <> <span className="badge warn">Schritt fällig</span></> : null}</h3>
                  <p className="muted small" style={{ margin: "4px 0 0" }}>
                    {[l.contactName, l.email, l.phone, l.canton].filter(Boolean).join(" · ") || "Keine Kontaktdaten"} · {LEAD_SOURCE_LABEL[l.source as keyof typeof LEAD_SOURCE_LABEL]} · seit {fmt(l.createdAt)}
                    {l.nextActionAt ? ` · nächster Schritt ${l.nextActionAt}` : ""}{l.hotelId ? <> · <a href={`/admin/${l.hotelId}`}>Betrieb öffnen</a></> : null}{l.website ? <> · <a href={l.website} target="_blank" rel="noopener noreferrer">Website</a></> : null}
                  </p>
                  {h?.reasons.length ? <ul className="ampel-reasons small">{h.reasons.map((r) => <li key={r.text} className={`ampel-${r.level}`}>{r.text}</li>)}</ul> : null}
                </div>
                <form action={changeStatus} className="inline-form">
                  <input type="hidden" name="id" value={l.id} /><input type="hidden" name="filter" value={filter} />
                  <select name="status" defaultValue={l.status} aria-label="Status">{LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}</select>
                  <button className="btn secondary small">Setzen</button>
                </form>
              </div>

              <details>
                <summary>Bearbeiten, Mail senden, Verlauf</summary>
                <div className="stack" style={{ marginTop: 12 }}>
                  <form action={saveLead} className="stack" style={{ maxWidth: 560 }}>
                    <input type="hidden" name="id" value={l.id} /><input type="hidden" name="filter" value={filter} />
                    <div className="form-row">
                      <div><label htmlFor={`f5768m1-${l.id}`}>Kontaktperson</label><input id={`f5768m1-${l.id}`} name="contactName" defaultValue={l.contactName} /></div>
                      <div><label htmlFor={`f5768m2-${l.id}`}>E-Mail</label><input id={`f5768m2-${l.id}`} name="email" type="email" defaultValue={l.email} /></div>
                      <div><label htmlFor={`f5768m3-${l.id}`}>Telefon</label><input id={`f5768m3-${l.id}`} name="phone" defaultValue={l.phone} /></div>
                      <div><label htmlFor={`f5768m4-${l.id}`}>Nächster Schritt am</label><input id={`f5768m4-${l.id}`} name="next" type="date" defaultValue={l.nextActionAt ?? ""} /></div>
                    </div>
                    <label>Notizen<textarea name="notes" rows={3} defaultValue={l.notes} /></label>
                    <label className="check"><input type="checkbox" name="dnc" defaultChecked={l.doNotContact} /> Nicht mehr kontaktieren (blockiert den Mailversand)</label>
                    <div><button className="btn small">Speichern</button></div>
                  </form>

                  <form action={mail} className="stack" style={{ maxWidth: 560 }}>
                    <input type="hidden" name="id" value={l.id} /><input type="hidden" name="filter" value={filter} />
                    <h4 className="plat-label">Persönliche Mail senden{l.lastMailAt ? ` (zuletzt ${fmt(l.lastMailAt)})` : ""}</h4>
                    <label>Vorlage<select name="template">{MAIL_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
                    <label>Eigene Zeile vorneweg (optional)<textarea name="extra" rows={2} /></label>
                    <div><button className="btn small" disabled={!l.email || l.doNotContact}>Mail senden</button> {!l.email ? <span className="muted small">Keine E-Mail hinterlegt</span> : null}</div>
                  </form>

                  <div>
                    <h4 className="plat-label">Verlauf</h4>
                    <ul className="plat-list small">{events.map((e) => <li key={e.id}><span>{e.text}</span><span className="muted">{fmt(e.createdAt)}</span></li>)}</ul>
                  </div>
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </div>
  );
}
