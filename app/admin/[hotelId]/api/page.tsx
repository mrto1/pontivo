import { Notice } from "@/components/admin/Notice";
import { InfoTip } from "@/components/admin/InfoTip";
import net from "node:net";
import { redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { PosBridgeError, createApiKey, listApiKeys, revokeApiKey } from "@/src/services/posbridge";
import { WebhookError, createEndpoint, deleteEndpoint, listEndpoints, recentDeliveries, saveReturnOrigins, sendPing } from "@/src/services/webhooks";
import { WEBHOOK_EVENTS } from "@/src/domain/webhooks";
import { env } from "@/src/env";
import { s } from "@/src/lib/form";
import { hotelAction, type HotelCtx } from "@/src/lib/hotel-action";

export const dynamic = "force-dynamic";

const run = (f: FormData, fail: string, fn: (c: HotelCtx) => Promise<string | { to: string }>) =>
  hotelAction(f, { page: "api", module: "api", role: "owner", fail }, fn);

async function create(f: FormData) {
  "use server";
  await run(f, "Nicht erstellt", async (c) => {
    const days = Number(s(f, "days") || 0);
    const ips = s(f, "ips").split(/[\s,;]+/).filter(Boolean);
    if (ips.some((i) => net.isIP(i) === 0)) throw new PosBridgeError("invalid", "IP-Adressen ungültig (einzelne IPv4/IPv6-Adressen, getrennt durch Komma).");
    const { key } = await createApiKey(c.hotel.id, s(f, "label"), c.actor, "website", { expiresAt: days > 0 ? new Date(Date.now() + days * 86_400_000) : null, allowedIps: ips });
    return { to: `/admin/${c.hotel.id}/api?new=${encodeURIComponent(key)}` };
  });
}
async function revoke(f: FormData) {
  "use server";
  await run(f, "Nicht widerrufen", async (c) => { await revokeApiKey(c.hotel.id, s(f, "id"), c.actor); return "Schlüssel widerrufen."; });
}

async function addHook(f: FormData) {
  "use server";
  await run(f, "Nicht gespeichert", async (c) => {
    const { secret } = await createEndpoint(c.hotel.id, s(f, "url"), f.getAll("events").map(String), c.actor);
    return { to: `/admin/${c.hotel.id}/api?secret=${encodeURIComponent(secret)}` };
  });
}
async function hookAction(f: FormData) {
  "use server";
  await run(f, "Nicht möglich", async (c) => {
    if (s(f, "do") === "delete") await deleteEndpoint(c.hotel.id, s(f, "id"), c.actor);
    else await sendPing(c.hotel.id, s(f, "id"), c.actor);
    return s(f, "do") === "delete" ? "Webhook-Adresse gelöscht." : "Testereignis wird gesendet (innerhalb einer Minute).";
  });
}
async function origins(f: FormData) {
  "use server";
  await run(f, "Nicht gespeichert", async (c) => { await saveReturnOrigins(c.hotel, s(f, "origins"), c.actor); return "Gespeichert."; });
}

export default async function ApiPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("api", hotelId, "owner");
  const keys = await listApiKeys(hotel.id, "website");
  const hooks = await listEndpoints(hotel.id);
  const deliveries = await recentDeliveries(hotel.id, 15);
  const base = `${env().APP_BASE_URL}/api/v1`;
  return (
    <div className="stack">
      <h1>Website-Schnittstelle</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <div><InfoTip label="Worum geht es hier?">Für Websites, die nicht mit Pontivo gebaut sind: Ihre Website holt Verfügbarkeit und Preise und legt Buchungen an. Bezahlt wird auf der sicheren Zahlungsseite, danach ist die Buchung bestätigt und der Gast bekommt die Mail. Es gilt dieselbe Gebühr wie bei einer Buchung auf Pontivo, die Schnittstelle selbst kostet nichts extra.</InfoTip></div>
      <p className="notice warn small">Der Schlüssel gehört nur auf den Server Ihrer Website, nie in den Browser oder in Skripte, die Besucher laden. Für reine Einbindung ohne Programmierung gibt es unter «Website & Buchung» das fertige Buchungs-Widget.</p>
      {sp.new ? (
        <div className="card stack">
          <h2>Neuer Schlüssel</h2>
          <p className="notice warn">Bitte jetzt kopieren und an Ihre Webagentur geben. Er wird nur einmal angezeigt.</p>
          <p><code className="break-all">{sp.new}</code></p>
        </div>
      ) : null}
      <form action={create} className="card stack">
        <input type="hidden" name="hotelId" value={hotel.id} />
        <div><label htmlFor="label">Bezeichnung (z. B. Name der Agentur oder Website)</label><input id="label" name="label" required maxLength={80} /></div>
        <div className="row">
          <label>Gültig für<select name="days" defaultValue="365"><option value="90">90 Tage</option><option value="365">1 Jahr</option><option value="0">unbegrenzt</option></select></label>
          <label className="flex1">Nur diese IP-Adressen (optional, Komma)<input name="ips" placeholder="203.0.113.10" /></label>
        </div>
        <div><button className="btn">Schlüssel erstellen</button></div>
      </form>
      <section className="card">
        <h2>Schlüssel</h2>
        {keys.length ? (
          <table className="table"><thead><tr><th>Bezeichnung</th><th>Anfang</th><th>Erstellt</th><th>Zuletzt benutzt</th><th>Gültig bis</th><th /></tr></thead><tbody>
            {keys.map((k) => (
              <tr key={k.id}><td>{k.label}</td><td><code>{k.prefix}…</code></td><td>{k.createdAt.toLocaleDateString("de-CH")}</td><td>{k.lastUsedAt ? k.lastUsedAt.toLocaleString("de-CH") : "nie"}</td><td className="small">{k.expiresAt ? k.expiresAt.toLocaleDateString("de-CH") : "unbegrenzt"}{k.allowedIps.length ? ` · IP: ${k.allowedIps.join(", ")}` : ""}</td>
                <td>{k.revokedAt ? "widerrufen" : <form action={revoke}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={k.id} /><button className="btn secondary">Widerrufen</button></form>}</td></tr>
            ))}
          </tbody></table>
        ) : <p className="muted">Noch kein Schlüssel.</p>}
      </section>
      <section className="card stack">
        <h2>Rückkehr nach der Zahlung</h2>
        <p className="small muted">Optional: Ihre Website kann bei der Buchung <code>return_url</code> mitgeben, dann kehrt der Gast nach der Zahlung dorthin zurück (mit <code>reference</code> und <code>result=paid|cancelled</code>). Erlaubt sind nur die hier eingetragenen Adressen (nur https, nur der Ursprung).</p>
        <form action={origins} className="row"><input type="hidden" name="hotelId" value={hotel.id} /><input name="origins" className="flex1" defaultValue={(hotel.content.api?.returnOrigins ?? []).join(", ")} placeholder="https://www.beispiel.ch" /><button className="btn secondary">Speichern</button></form>
      </section>
      <section className="card stack">
        <h2>Webhooks</h2>
        <p className="small muted">Pontivo meldet Ihrer Website, wenn eine Buchung bezahlt, storniert oder nicht bezahlt wurde (ohne Gästedaten). Jede Meldung ist mit dem Geheimnis der Adresse signiert; bei Fehlern wird bis zu 7 Mal wiederholt.</p>
        {sp.secret ? <div className="notice warn"><strong>Geheimnis der neuen Adresse (nur jetzt sichtbar):</strong><br /><code className="break-all">{sp.secret}</code></div> : null}
        <form action={addHook} className="stack">
          <input type="hidden" name="hotelId" value={hotel.id} />
          <label>Adresse (https)<input name="url" placeholder="https://www.beispiel.ch/pontivo-webhook" required /></label>
          <div className="row small">{WEBHOOK_EVENTS.filter((e) => e !== "ping").map((e) => <label key={e} className="check"><input type="checkbox" name="events" value={e} defaultChecked /> {e}</label>)}</div>
          <div><button className="btn">Adresse hinzufügen</button></div>
        </form>
        {hooks.map((h) => (
          <form key={h.id} action={hookAction} className="row small">
            <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={h.id} />
            <code style={{ flex: 1, wordBreak: "break-all" }}>{h.url}</code><span className="muted">{h.events.join(", ")}</span>
            <button className="btn secondary small" name="do" value="ping">Test senden</button><button className="btn secondary small" name="do" value="delete">Löschen</button>
          </form>
        ))}
        {deliveries.length ? (
          <table className="table small"><thead><tr><th>Zeit</th><th>Ereignis</th><th>Status</th><th>Versuche</th></tr></thead><tbody>
            {deliveries.map((d) => <tr key={d.id}><td>{d.createdAt.toLocaleString("de-CH")}</td><td>{d.event}</td><td>{d.status === "sent" ? "zugestellt" : d.status === "failed" ? `fehlgeschlagen (${d.lastError})` : `wartet${d.lastError ? ` (${d.lastError})` : ""}`}</td><td>{d.attempts}</td></tr>)}
          </tbody></table>
        ) : null}
      </section>
      <section className="card stack">
        <h2>Für die Webagentur</h2>
        <p className="small"><a href="/api/v1/openapi.json">OpenAPI-Beschreibung (JSON)</a> zum Import in Postman oder Code-Generatoren. Optionaler Header <code>Idempotency-Key</code> bei <code>POST /bookings</code> (gleicher Schlüssel und gleiche Anfrage = gleiche Antwort, nichts doppelt). Storno: <code>GET/POST /bookings/&lt;reference&gt;/cancel</code>. Signatur der Webhooks: Header <code>Pontivo-Signature: t=…,v1=…</code> (HMAC-SHA256 über <code>t.Rumpf</code>).</p>
        <p className="small">Alle Aufrufe mit Header <code>Authorization: Bearer pnt_…</code>. Beträge in Rappen (CHF). Höchstens 60 Anfragen pro Minute (Buchungen 30).</p>
        <p><code>GET {base}/hotel</code><br /><span className="small muted">Betrieb, Sprachen, Check-in/out-Zeiten, Zimmertypen und Tarife (IDs für die Buchung).</span></p>
        <p><code>GET {base}/availability?checkin=2026-12-20&amp;checkout=2026-12-23&amp;adults=2&amp;children=0&amp;rooms=1</code><br /><span className="small muted">Angebote mit Nachtpreisen, Total inkl. Kurtaxe und Pflicht-Zusatzleistungen, Stornobedingung. Bei Kindern ggf. <code>ages=7,9</code> (Antwort 422 <code>child_ages_required</code>).</span></p>
        <p><code>POST {base}/bookings</code></p>
        <pre style={{ overflow: "auto" }}>{`{
  "room_type_id": "…", "rate_plan_id": "…",
  "checkin": "2026-12-20", "checkout": "2026-12-23",
  "adults": 2, "children": 0, "rooms": 1,
  "guest": { "first_name": "Anna", "last_name": "Muster", "email": "anna@example.ch", "language": "de" },
  "terms_accepted": true        // Ihre Website zeigt AGB und Datenschutz und holt die Zustimmung ein
}`}</pre>
        <p className="small muted">Antwort 201 mit <code>reference</code> und <code>checkout_url</code>: den Gast dorthin weiterleiten. Die Zimmer sind 32 Minuten reserviert. 409 = ausgebucht, 422 = Eingabe passt nicht zum Angebot. Nach der Zahlung landet der Gast auf seiner Buchungsseite bei Pontivo.</p>
        <p><code>GET {base}/bookings/&lt;reference&gt;</code><br /><span className="small muted">Status (<code>pending</code>, <code>confirmed</code>, <code>cancelled</code> …), damit Ihre Website den Ausgang anzeigen kann.</span></p>
        <p className="small muted">Zusatzleistungen (<code>extras</code>, IDs aus <code>/hotel</code>) und Gutscheine (<code>voucher_code</code>) gehen im Buchungs-Aufruf mit.</p>
      </section>
    </div>
  );
}
