import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireHotel } from "@/src/auth/guard";
import { moduleOn, requireModule } from "@/src/services/modules";
import { refreshProposals, runsToday } from "@/src/services/ai-pricing";
import { env } from "@/src/env";
import { atLeast } from "@/src/auth/session";
import { db } from "@/src/db/client";
import { ratePlans } from "@/src/db/schema";
import { todayIn } from "@/src/domain/dates";
import { formatDay } from "@/src/i18n/dict";
import {
  PricingError, addEvent, applyProposals, deleteEvent, dismissProposals, generateProposals, listEvents, listProposals, listRules, saveRule,
} from "@/src/services/pricing-rules";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => Math.round(Number(s(f, k).replace(",", ".")) || 0);
const chf = (r: number) => (r / 100).toLocaleString("de-CH", { minimumFractionDigits: 0 });
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

async function guard(f: FormData) {
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "pricing_rules");
  return c;
}
const back = (id: string, msg: string) => redirect(`/admin/${id}/preise?msg=${encodeURIComponent(msg)}`);

async function saveAction(f: FormData) {
  "use server";
  const c = await guard(f);
  let msg = "Regel gespeichert.";
  try {
    const steps = [1, 2, 3].filter((i) => s(f, `st${i}p`) !== "").map((i) => ({ fromPct: num(f, `st${i}p`), bps: num(f, `st${i}b`) * 100 }));
    const lmDays = s(f, "lmDays");
    await saveRule(c.hotel.id, s(f, "ratePlanId"), {
      baseRappen: num(f, "base") * 100, minRappen: num(f, "min") * 100, maxRappen: num(f, "max") * 100,
      occupancySteps: steps,
      lastMinute: lmDays === "" ? null : { withinDays: num(f, "lmDays"), belowPct: num(f, "lmBelow"), bps: num(f, "lmBps") * 100 },
      weekdayBps: [0, 1, 2, 3, 4, 5, 6].map((d) => num(f, `wd${d}`) * 100),
      autoApply: f.get("auto") === "on", active: f.get("active") === "on",
    }, c.actor);
  } catch (e) {
    if (!(e instanceof PricingError)) throw e;
    msg = `Nicht gespeichert: ${e.message}`;
  }
  back(c.hotel.id, msg);
}
async function eventAction(f: FormData) {
  "use server";
  const c = await guard(f);
  let msg = "Ereignis gespeichert.";
  try { await addEvent(c.hotel.id, { name: s(f, "name"), fromDay: s(f, "from"), toDay: s(f, "to") || s(f, "from"), adjustBps: num(f, "pct") * 100 }, c.actor); }
  catch (e) { if (!(e instanceof PricingError)) throw e; msg = `Nicht gespeichert: ${e.message}`; }
  back(c.hotel.id, msg);
}
async function deleteEventAction(f: FormData) {
  "use server";
  const c = await guard(f);
  await deleteEvent(c.hotel.id, s(f, "id"), c.actor);
  back(c.hotel.id, "Ereignis gelöscht.");
}
async function computeAction(f: FormData) {
  "use server";
  const c = await guard(f);
  const r = await generateProposals(c.hotel.id, todayIn(c.hotel.timezone), c.actor);
  back(c.hotel.id, r.applied ? `${r.applied} Preise automatisch übernommen.` : `${r.proposed} Vorschläge berechnet.`);
}
async function aiAction(f: FormData) {
  "use server";
  const c = await guard(f);
  const r = await refreshProposals(c.hotel, c.actor);
  if ("aiError" in r && r.aiError) back(c.hotel.id, `Nicht berechnet: ${r.aiError}`);
  back(c.hotel.id, r.ai ? `KI-Empfehlung fertig: ${r.ai.proposed} Vorschläge${r.ai.applied ? `, ${r.ai.applied} automatisch übernommen` : ""}.` : "Keine KI-Berechnung (Modul aus).");
}
async function decideAction(f: FormData) {
  "use server";
  const c = await guard(f);
  const ids = f.getAll("id").map(String);
  if (s(f, "do") === "apply") back(c.hotel.id, `${await applyProposals(c.hotel.id, ids, c.actor)} Preise übernommen.`);
  await dismissProposals(c.hotel.id, ids, c.actor);
  back(c.hotel.id, "Vorschläge verworfen.");
}

export default async function PricingAdmin({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "staff", "pricing");
  await requireModule(hotel.id, "pricing_rules");
  const today = todayIn(hotel.timezone);
  const manage = atLeast(role, "manager");
  const [plans, rules, events, proposals] = await Promise.all([
    db().select().from(ratePlans).where(and(eq(ratePlans.hotelId, hotel.id), eq(ratePlans.active, true))).orderBy(ratePlans.createdAt),
    listRules(hotel.id), listEvents(hotel.id, today), listProposals(hotel.id, today),
  ]);
  const byPlan = new Map(rules.map((r) => [r.ratePlanId, r]));
  const ai = (await moduleOn(hotel.id, "ai_pricing")) && !!env().ANTHROPIC_API_KEY;
  const aiLeft = ai ? Math.max(0, env().AI_PRICING_RUNS_PER_DAY - (await runsToday(hotel.id, today))) : 0;
  return (
    <div className="stack">
      <h1>Preisempfehlung</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      <p className="muted">Nach Ihren Regeln schlägt Pontivo täglich Preise für die nächsten 90 Nächte vor, mit einem Satz als Begründung. Nichts ändert sich ohne Ihre Bestätigung, ausser Sie schalten «automatisch übernehmen» ein: dann nur innerhalb von Mindest- und Höchstpreis. Übernommene Preise gehen wie alle Kalenderänderungen an Ihre Kanäle.</p>

      <section className="card stack">
        <h2>Vorschläge {proposals.length ? `(${proposals.length})` : ""}</h2>
        {manage ? (
          <div className="row">
            <form action={computeAction}><input type="hidden" name="hotelId" value={hotel.id} /><button className="btn secondary">Jetzt nach Regeln neu berechnen</button></form>
            {ai ? <form action={aiAction}><input type="hidden" name="hotelId" value={hotel.id} /><button className="btn" disabled={aiLeft === 0}>Mit KI neu berechnen</button></form> : null}
          </div>
        ) : null}
        {ai ? <p className="small muted" style={{ margin: 0 }}>KI-Preisempfehlung ist an: Sie schlägt Preise innerhalb Ihres Preiskorridors vor, stützt sich nur auf Ihre Zahlen (keine Konkurrenzpreise) und ändert nichts ohne Ihre Bestätigung, ausser «automatisch übernehmen» ist bei der Regel eingeschaltet. Heute noch {aiLeft} Berechnungen. Läuft ausserdem täglich nachts.</p> : null}
        {proposals.length ? (
          <form action={decideAction} className="stack">
            <input type="hidden" name="hotelId" value={hotel.id} />
            <table className="table"><thead><tr><th></th><th>Nacht</th><th>Tarif</th><th>Jetzt</th><th>Vorschlag</th><th>Begründung</th></tr></thead><tbody>
              {proposals.map((p) => (
                <tr key={p.id}>
                  <td><input type="checkbox" name="id" value={p.id} defaultChecked aria-label="Vorschlag wählen" /></td>
                  <td>{formatDay(p.night, "de")}</td><td>{p.planName}</td><td>CHF {chf(p.currentRappen)}</td><td><strong>CHF {chf(p.proposedRappen)}</strong></td><td>{p.source === "ai" ? <span className="badge">KI</span> : null} {p.reason.replace(/^KI: /, "")}</td>
                </tr>
              ))}
            </tbody></table>
            {manage ? <div className="row"><button className="btn" name="do" value="apply">Gewählte übernehmen</button><button className="btn secondary" name="do" value="dismiss">Gewählte verwerfen</button></div> : null}
          </form>
        ) : <p className="muted">Keine offenen Vorschläge.</p>}
      </section>

      {plans.map((p) => {
        const r = byPlan.get(p.id);
        const st = r?.occupancySteps ?? [];
        return (
          <form key={p.id} action={saveAction} className="card stack">
            <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="ratePlanId" value={p.id} />
            <h2>{p.name}</h2>
            <div className="row">
              <div><label>Basispreis (CHF)</label><input name="base" type="number" min={1} defaultValue={r ? r.baseRappen / 100 : ""} required /></div>
              <div><label>Mindestpreis (CHF)</label><input name="min" type="number" min={1} defaultValue={r ? r.minRappen / 100 : ""} required /></div>
              <div><label>Höchstpreis (CHF)</label><input name="max" type="number" min={1} defaultValue={r ? r.maxRappen / 100 : ""} required /></div>
            </div>
            <fieldset><legend>Auslastung des Zimmertyps (ab … % gebucht → Zu-/Abschlag in %)</legend>
              {[1, 2, 3].map((i) => (
                <div className="row" key={i}>
                  <div><label>ab % Auslastung</label><input name={`st${i}p`} type="number" min={0} max={100} defaultValue={st[i - 1]?.fromPct ?? ""} /></div>
                  <div><label>Zu-/Abschlag %</label><input name={`st${i}b`} type="number" min={-100} max={100} defaultValue={st[i - 1] ? st[i - 1].bps / 100 : ""} /></div>
                </div>
              ))}
            </fieldset>
            <fieldset><legend>Last Minute (leer lassen = aus)</legend>
              <div className="row">
                <div><label>innerhalb Tage</label><input name="lmDays" type="number" min={0} defaultValue={r?.lastMinute?.withinDays ?? ""} /></div>
                <div><label>bei Auslastung unter %</label><input name="lmBelow" type="number" min={0} max={100} defaultValue={r?.lastMinute?.belowPct ?? ""} /></div>
                <div><label>Zu-/Abschlag %</label><input name="lmBps" type="number" min={-100} max={100} defaultValue={r?.lastMinute ? r.lastMinute.bps / 100 : ""} /></div>
              </div>
            </fieldset>
            <fieldset><legend>Wochentag (Zu-/Abschlag %)</legend>
              <div className="row">{WD.map((w, d) => <div key={d}><label>{w}</label><input name={`wd${d}`} type="number" min={-100} max={100} defaultValue={r ? r.weekdayBps[d] / 100 : 0} /></div>)}</div>
            </fieldset>
            <label><input type="checkbox" name="active" defaultChecked={r?.active ?? true} /> Regel aktiv</label>
            <label><input type="checkbox" name="auto" defaultChecked={r?.autoApply ?? false} /> Automatisch übernehmen (nur innerhalb Mindest- und Höchstpreis)</label>
            {manage ? <div><button className="btn">Regel speichern</button></div> : null}
          </form>
        );
      })}

      <section className="card stack">
        <h2>Ereignisse (Messe, Feiertag, Anlass)</h2>
        {manage ? (
          <form action={eventAction} className="row">
            <input type="hidden" name="hotelId" value={hotel.id} />
            <div><label>Name</label><input name="name" required /></div>
            <div><label>Von</label><input name="from" type="date" required /></div>
            <div><label>Bis (inkl.)</label><input name="to" type="date" /></div>
            <div><label>Zu-/Abschlag %</label><input name="pct" type="number" min={-100} max={100} required /></div>
            <div><button className="btn">Hinzufügen</button></div>
          </form>
        ) : null}
        {events.length ? (
          <table className="table"><tbody>
            {events.map((e) => (
              <tr key={e.id}><td>{e.name}</td><td>{formatDay(e.fromDay, "de")} bis {formatDay(e.toDay, "de")}</td><td>{e.adjustBps > 0 ? "+" : ""}{e.adjustBps / 100} %</td>
                <td>{manage ? <form action={deleteEventAction}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={e.id} /><button className="btn secondary">Löschen</button></form> : null}</td></tr>
            ))}
          </tbody></table>
        ) : <p className="muted">Keine Ereignisse eingetragen.</p>}
      </section>
    </div>
  );
}
