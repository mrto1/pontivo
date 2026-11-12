import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { channexConfigured, type AirbnbListing } from "@/src/integrations/channex/client";
import { channelErrorText, mappablePlans } from "@/src/integrations/channex/channels";
import {
  activateAirbnb,
  airbnbConnectLink,
  airbnbListings,
  getAirbnbChannel,
  mapAirbnbListing,
  removeAirbnb,
  unmapAirbnbListing,
} from "@/src/integrations/channex/airbnb";

export const dynamic = "force-dynamic";

const back = (id: string, msg: string) => redirect(`/admin/${id}/channex/airbnb?msg=${encodeURIComponent(msg)}`);
const hid = (f: FormData) => String(f.get("hotelId"));

async function run(f: FormData, fn: (h: Awaited<ReturnType<typeof requireHotel>>) => Promise<string>) {
  const ctx = await requireHotel(hid(f), "manager");
  let msg: string;
  try {
    msg = await fn(ctx);
  } catch (e) {
    msg = `Fehler: ${channelErrorText(e)}`;
  }
  back(ctx.hotel.id, msg);
}

async function connectAction(f: FormData) {
  "use server";
  const ctx = await requireHotel(hid(f), "manager");
  let url: string;
  try {
    url = await airbnbConnectLink(ctx.hotel, ctx.actor);
  } catch (e) {
    back(ctx.hotel.id, `Fehler: ${channelErrorText(e)}`);
    return;
  }
  redirect(url);
}
async function mapAction(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    const plan = String(f.get("ratePlanId") ?? "");
    if (!plan) throw new Error("Bitte einen Tarif wählen");
    await mapAirbnbListing(hotel, String(f.get("listingId")), plan, actor);
    return "Inserat zugeordnet. Airbnb bestätigt die Zuordnung in etwa 30 Sekunden.";
  });
}
async function unmapAction(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await unmapAirbnbListing(hotel, String(f.get("listingId")), actor);
    return "Zuordnung aufgehoben";
  });
}
async function activateAction(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    if (f.get("confirm") !== "on") throw new Error("Bitte bestätigen, dass Preise und Verfügbarkeit stimmen");
    const r = await activateAirbnb(hotel, actor);
    return r.loaded ? "Airbnb ist verbunden. Bestehende Reservationen werden geladen." : "Airbnb ist verbunden, aber nicht alle Reservationen konnten geladen werden (siehe Hinweis).";
  });
}
async function removeAction(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    if (f.get("confirm") !== "on") throw new Error("Bitte das Entfernen bestätigen");
    await removeAirbnb(hotel, actor);
    return "Verbindung zu Airbnb entfernt";
  });
}

export default async function AirbnbChannelPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const canEdit = atLeast(role, "manager") && channexConfigured();
  const ch = await getAirbnbChannel(hotel.id);
  const plans = (await mappablePlans(hotel.id)).filter((p) => p.channexRatePlanId);
  let listings: AirbnbListing[] = [];
  let listError: string | null = null;
  if (ch?.channexChannelId) {
    try {
      listings = await airbnbListings(hotel.id);
    } catch (e) {
      listError = channelErrorText(e);
    }
  }
  const mapped = new Map((ch?.mappings ?? []).map((m) => [m.listingId, m]));
  const usedPlans = new Set((ch?.mappings ?? []).map((m) => m.ratePlanId));
  const planName = new Map(plans.map((p) => [p.id, `${p.roomName} – ${p.name}`]));
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;
  const connected = !!ch?.channexChannelId;
  const statusText = !connected ? "nicht verbunden" : ch!.status === "active" ? "aktiv" : "verbunden, nicht aktiv";

  return (
    <div className="stack">
      <p className="small"><a href={`/admin/${hotel.id}/channex`}>← Channel-Manager</a></p>
      <h1>Airbnb verbinden</h1>
      {sp.msg ? <p className="notice">{sp.msg}</p> : null}
      {!channexConfigured() ? <p className="notice warn">Channex ist auf dem Server nicht konfiguriert.</p> : null}
      {!hotel.channexPropertyId ? <p className="notice warn">Zuerst auf der Channex-Seite «In Channex anlegen» ausführen.</p> : null}

      <section className="card stack">
        <h2>1. Airbnb-Konto freigeben</h2>
        <div className="kv">
          <span className="muted">Status</span><span><span className={`badge ${ch?.status === "active" ? "" : "warn"}`}>{statusText}</span></span>
        </div>
        {ch?.lastError ? <p className="notice warn">{ch.lastError}</p> : null}
        <p className="small">
          Sie werden zu Airbnb weitergeleitet, melden sich dort an und erlauben den Abgleich. Danach kommen Sie hierher zurück.
          Ihre Inserate müssen auf Airbnb bereits bestehen.
        </p>
        <ul className="small">
          <li>Beim Zuordnen stellt Airbnb das Inserat auf <strong>Sofortbuchung</strong> um (danach auf Airbnb wieder abschaltbar).</li>
          <li><strong>Smart Pricing</strong> wird abgeschaltet, die Preise kommen aus Pontivo.</li>
          <li>Ist bei einem Inserat bereits ein anderer Channel-Manager verbunden, muss dieser zuerst getrennt werden.</li>
        </ul>
        {canEdit && hotel.channexPropertyId ? (
          <form action={connectAction}>{hidden}<button className="btn">{connected ? "Neu verbinden (Freigabe erneuern)" : "Mit Airbnb verbinden"}</button></form>
        ) : null}
      </section>

      {connected ? (
        <section className="card stack">
          <h2>2. Inserate zuordnen</h2>
          <p className="small">Jedem Inserat einen Pontivo-Tarif zuordnen. Preise, Verfügbarkeit und Mindestaufenthalt kommen dann aus Pontivo.</p>
          {listError ? <p className="notice warn">Inserate konnten nicht geladen werden: {listError}</p> : null}
          {!listError && !listings.length ? <p className="muted small">Keine Inserate im verbundenen Airbnb-Konto gefunden.</p> : null}
          {listings.length ? (
            <table className="table small">
              <thead><tr><th>Airbnb-Inserat</th><th>Pontivo-Tarif</th><th></th></tr></thead>
              <tbody>
                {listings.map((l) => {
                  const m = mapped.get(l.id);
                  return (
                    <tr key={l.id}>
                      <td>
                        <strong>{l.title}</strong>
                        <div className="muted">{[l.city, l.occupancies.length ? `bis ${Math.max(...l.occupancies)} Gäste` : ""].filter(Boolean).join(" · ")}</div>
                      </td>
                      {m ? (
                        <>
                          <td>{planName.get(m.ratePlanId) ?? "–"}</td>
                          <td>{canEdit ? <form action={unmapAction}>{hidden}<input type="hidden" name="listingId" value={l.id} /><button className="btn secondary">Aufheben</button></form> : null}</td>
                        </>
                      ) : (
                        <td colSpan={2}>
                          {canEdit ? (
                            <form action={mapAction} className="inline-form">
                              {hidden}
                              <input type="hidden" name="listingId" value={l.id} />
                              <select name="ratePlanId" defaultValue="">
                                <option value="">– Tarif wählen –</option>
                                {plans.filter((p) => !usedPlans.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.roomName} – {p.name}</option>)}
                              </select>
                              <button className="btn secondary">Zuordnen</button>
                            </form>
                          ) : <span className="muted">nicht zugeordnet</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      {connected && canEdit && ch!.status !== "active" ? (
        <section className="card stack">
          <h2>3. Aktivieren</h2>
          <p className="small">
            Beim Aktivieren sendet Channex Preise, Verfügbarkeit und Regeln aus Pontivo an Airbnb. Danach werden die bestehenden künftigen Reservationen geladen.
          </p>
          {!hotel.channexEnabled ? <p className="notice warn">Zuerst auf der Channex-Seite den Abgleich einschalten.</p> : null}
          <form action={activateAction} className="stack">
            {hidden}
            <label><input type="checkbox" name="confirm" required /> Preise, Verfügbarkeit und Mindestaufenthalte in Pontivo stimmen.</label>
            <div><button className="btn" disabled={!hotel.channexEnabled || !ch!.mappings.length}>Airbnb aktivieren</button></div>
          </form>
        </section>
      ) : null}

      {ch && canEdit ? (
        <section className="card stack">
          <h2>Verbindung entfernen</h2>
          <p className="small muted">Hebt alle Zuordnungen auf und trennt das Airbnb-Konto. Bereits erhaltene Buchungen bleiben erhalten.</p>
          <form action={removeAction} className="stack">
            {hidden}
            <label><input type="checkbox" name="confirm" required /> Ja, Verbindung zu Airbnb entfernen</label>
            <div><button className="btn secondary">Entfernen</button></div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
