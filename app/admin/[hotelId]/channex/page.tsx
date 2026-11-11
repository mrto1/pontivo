import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { db } from "@/src/db/client";
import { ratePlans, roomTypes } from "@/src/db/schema";
import { channexConfigured } from "@/src/integrations/channex/client";
import { channexStatus, createInChannex, disableChannex, enableChannex, ratePlanCoverage, saveMapping } from "@/src/integrations/channex/connect";
import { coverageIssue } from "@/src/domain/channex-readiness";
import { todayIn } from "@/src/domain/dates";
import { enqueueFullSync } from "@/src/integrations/channex/outbox-worker";
import { pullFeed } from "@/src/integrations/channex/feed";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

const back = (id: string, msg: string) => redirect(`/admin/${id}/channex?msg=${encodeURIComponent(msg)}`);
const hid = (f: FormData) => String(f.get("hotelId"));

async function run(f: FormData, fn: (h: Awaited<ReturnType<typeof requireHotel>>) => Promise<string>) {
  const ctx = await requireHotel(hid(f), "manager");
  let msg: string;
  try {
    msg = await fn(ctx);
  } catch (e) {
    msg = `Fehler: ${(e as Error).message}`;
  }
  back(ctx.hotel.id, msg);
}

async function createAction(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await createInChannex(hotel, actor);
    return "In Channex angelegt. Jetzt Abgleich einschalten.";
  });
}
async function mappingAction(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    const rts: Record<string, string | null> = {};
    const rps: Record<string, string | null> = {};
    for (const [k, v] of f.entries()) {
      if (k.startsWith("rt:")) rts[k.slice(3)] = String(v);
      if (k.startsWith("rp:")) rps[k.slice(3)] = String(v);
    }
    await saveMapping(hotel, { propertyId: String(f.get("propertyId") ?? ""), roomTypes: rts, ratePlans: rps }, actor);
    return "Zuordnung gespeichert";
  });
}
async function enableAction(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    if (f.get("confirm") !== "on") throw new Error("Bitte zuerst bestätigen, dass Preise und Verfügbarkeit gepflegt sind");
    await enableChannex(hotel, actor);
    return "Abgleich eingeschaltet, Vollabgleich läuft";
  });
}
async function disableAction(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await disableChannex(hotel, actor);
    return "Abgleich ausgeschaltet";
  });
}
async function fullSyncAction(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await enqueueFullSync(hotel, actor);
    return "Vollabgleich eingereiht";
  });
}
async function pullAction(f: FormData) {
  "use server";
  await run(f, async () => {
    const r = await pullFeed();
    return `Buchungen abgerufen: ${r.acked} übernommen, ${r.failed} fehlgeschlagen`;
  });
}

export default async function ChannexPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const canEdit = atLeast(role, "manager");
  const rts = await db().select().from(roomTypes).where(eq(roomTypes.hotelId, hotel.id)).orderBy(roomTypes.sortOrder);
  const rps = await db().select().from(ratePlans).where(eq(ratePlans.hotelId, hotel.id)).orderBy(ratePlans.createdAt);
  const status = await channexStatus(hotel.id);
  const configured = channexConfigured();
  const coverage = await ratePlanCoverage(hotel.id, todayIn(hotel.timezone));
  const issues = rps
    .map((p) => coverageIssue({ name: p.name, ...(coverage.get(p.id) ?? { pricedDays: 0, lastNight: null }) }, todayIn(hotel.timezone)))
    .filter((x): x is string => x !== null);
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;

  return (
    <div className="stack">
      <h1>Channel-Manager (Channex)</h1>
      {sp.msg ? <p className="notice">{sp.msg}</p> : null}
      {!configured ? <p className="notice warn">Channex ist auf dem Server nicht konfiguriert (<code>CHANNEX_API_KEY</code> fehlt).</p> : null}

      <section className="card stack">
        <h2>Status</h2>
        <div className="kv">
          <span className="muted">Abgleich</span><span><span className={`badge ${hotel.channexEnabled ? "" : "warn"}`}>{hotel.channexEnabled ? "aktiv" : "aus"}</span></span>
          <span className="muted">Property-ID</span><span>{hotel.channexPropertyId ?? "–"}</span>
          <span className="muted">Offene Änderungen</span><span>{status.pending}</span>
          <span className="muted">Fehlgeschlagen</span><span>{status.failed}</span>
          <span className="muted">Letzte Synchronisation</span><span>{status.last_sent ? new Date(status.last_sent).toLocaleString("de-CH", { timeZone: hotel.timezone }) : "–"}</span>
        </div>
        {status.errors.length ? (
          <table className="table small">
            <thead><tr><th>Art</th><th>Status</th><th>Fehler</th></tr></thead>
            <tbody>{status.errors.map((e) => <tr key={e.id}><td>{e.kind}</td><td>{e.status}</td><td>{e.error}</td></tr>)}</tbody>
          </table>
        ) : null}
        {status.recent.length ? (
          <details>
            <summary>Letzte Übertragungen</summary>
            <table className="table small">
              <thead><tr><th>Gesendet</th><th>Art</th><th>Änderungen</th><th>Channex-Task</th></tr></thead>
              <tbody>
                {status.recent.map((r) => (
                  <tr key={r.task_id}>
                    <td>{new Date(r.sent_at).toLocaleString("de-CH", { timeZone: hotel.timezone })}</td>
                    <td>{r.kind === "availability" ? "Verfügbarkeit" : "Preise/Regeln"}</td>
                    <td>{r.entries}</td>
                    <td><code>{r.task_id}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : null}
        {canEdit && configured ? (
          <div className="inline-form">
            {hotel.channexEnabled ? (
              <>
                <form action={fullSyncAction}>{hidden}<button className="btn secondary">Vollabgleich senden</button></form>
                <form action={pullAction}>{hidden}<button className="btn secondary">Buchungen jetzt abrufen</button></form>
                <form action={disableAction}>{hidden}<button className="btn secondary">Abgleich ausschalten</button></form>
              </>
            ) : (
              <form action={enableAction} className="stack">
                {hidden}
                <label><input type="checkbox" name="confirm" required /> Preise, Verfügbarkeit und Mindestaufenthalte sind für alle Tarife gepflegt.</label>
                <div><button className="btn" disabled={!hotel.channexPropertyId}>Abgleich einschalten</button></div>
              </form>
            )}
          </div>
        ) : null}
        <p className="muted small">
          Webhook in Channex: <code>{env().APP_BASE_URL}/api/webhooks/channex</code>, Ereignisse <code>booking</code>, signiert (HMAC). <strong>Nötig:</strong> ohne Webhook kommen Buchungen erst nach bis zu 15 Minuten (Überbuchungsgefahr).
          Die Verbindung zu Booking.com richtet das Hotel in Channex ein.
        </p>
      </section>

      {canEdit && configured ? (
        <section className="card stack">
          <h2>Vor der Anbindung an Booking.com oder Airbnb</h2>
          <p className="small">Pontivo sendet Preise und Verfügbarkeit an Channex. Sobald du den Kanal in Channex aktivierst, übernimmt er diese Werte. Prüfe deshalb vorher:</p>
          <ul className="small">
            <li>Preise, Verfügbarkeit und Mindestaufenthalte sind in Pontivo für alle Tarife gepflegt.</li>
            <li><strong>Booking.com:</strong> Die Aktivierung führt einen Vollabgleich durch und <strong>überschreibt</strong>, was dort steht. Sende danach sofort einen Vollabgleich.</li>
            <li><strong>Airbnb:</strong> Das Inserat muss schon bestehen. Beim Zuordnen wird es auf <strong>Sofortbuchung</strong> umgestellt (danach wieder abschaltbar) und <strong>Smart Pricing wird deaktiviert</strong>.</li>
          </ul>
          {issues.length ? (
            <div className="notice warn">
              <strong>Prüfen:</strong>
              <ul className="small">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ) : (
            <p className="muted small">Preise: für alle Tarife mindestens 90 Tage im Voraus hinterlegt.</p>
          )}
        </section>
      ) : null}

      {canEdit && configured ? (
        <section className="card stack">
          <h2>Zuordnung</h2>
          <p className="small">Neu bei Channex? Dann legt dieser Knopf Property, Zimmertypen und Ratepläne automatisch an:</p>
          <form action={createAction}>{hidden}<button className="btn secondary">In Channex anlegen</button></form>
          <p className="small">Oder bestehende IDs aus Channex eintragen:</p>
          <form action={mappingAction} className="stack">
            {hidden}
            <div><label>Property-ID</label><input name="propertyId" defaultValue={hotel.channexPropertyId ?? ""} placeholder="UUID" /></div>
            {rts.map((rt) => (
              <div key={rt.id} className="card stack">
                <div><label>{rt.name} – Room Type ID</label><input name={`rt:${rt.id}`} defaultValue={rt.channexRoomTypeId ?? ""} placeholder="UUID" /></div>
                {rps.filter((p) => p.roomTypeId === rt.id).map((p) => (
                  <div key={p.id}><label>↳ {p.name} – Rate Plan ID</label><input name={`rp:${p.id}`} defaultValue={p.channexRatePlanId ?? ""} placeholder="UUID" /></div>
                ))}
              </div>
            ))}
            <button className="btn">Zuordnung speichern</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
