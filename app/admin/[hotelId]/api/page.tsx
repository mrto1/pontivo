import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosBridgeError, createApiKey, listApiKeys, revokeApiKey } from "@/src/services/posbridge";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function create(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "owner");
  await requireModule(c.hotel.id, "api");
  try {
    const { key } = await createApiKey(c.hotel.id, s(f, "label"), c.actor, "website");
    redirect(`/admin/${c.hotel.id}/api?new=${encodeURIComponent(key)}`);
  } catch (e) {
    if (!(e instanceof PosBridgeError)) throw e;
    redirect(`/admin/${c.hotel.id}/api?msg=${encodeURIComponent(`Nicht erstellt: ${e.message}`)}`);
  }
}
async function revoke(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "owner");
  await requireModule(c.hotel.id, "api");
  await revokeApiKey(c.hotel.id, s(f, "id"), c.actor);
  redirect(`/admin/${c.hotel.id}/api?msg=${encodeURIComponent("Schlüssel widerrufen.")}`);
}

export default async function ApiPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "owner");
  await requireModule(hotel.id, "api");
  const keys = await listApiKeys(hotel.id, "website");
  const base = `${env().APP_BASE_URL}/api/v1`;
  return (
    <div className="stack">
      <h1>Website-Schnittstelle</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      <p className="muted">Für Websites, die nicht mit Pontivo gebaut sind: Ihre Website holt Verfügbarkeit und Preise und legt Buchungen an. Bezahlt wird auf der sicheren Zahlungsseite, danach ist die Buchung bestätigt und der Gast bekommt die Mail. Es gilt dieselbe Gebühr wie bei einer Buchung auf Pontivo, die Schnittstelle selbst kostet nichts extra.</p>
      <p className="notice warn small">Der Schlüssel gehört nur auf den Server Ihrer Website, nie in den Browser oder in Skripte, die Besucher laden. Für reine Einbindung ohne Programmierung gibt es unter «Einbinden» das fertige Buchungs-Widget.</p>
      {sp.new ? (
        <div className="card stack">
          <h2>Neuer Schlüssel</h2>
          <p className="notice warn">Bitte jetzt kopieren und an Ihre Webagentur geben. Er wird nur einmal angezeigt.</p>
          <p><code style={{ wordBreak: "break-all" }}>{sp.new}</code></p>
        </div>
      ) : null}
      <form action={create} className="card stack">
        <input type="hidden" name="hotelId" value={hotel.id} />
        <div><label htmlFor="label">Bezeichnung (z. B. Name der Agentur oder Website)</label><input id="label" name="label" required maxLength={80} /></div>
        <div><button className="btn">Schlüssel erstellen</button></div>
      </form>
      <section className="card">
        <h2>Schlüssel</h2>
        {keys.length ? (
          <table className="table"><thead><tr><th>Bezeichnung</th><th>Anfang</th><th>Erstellt</th><th>Zuletzt benutzt</th><th /></tr></thead><tbody>
            {keys.map((k) => (
              <tr key={k.id}><td>{k.label}</td><td><code>{k.prefix}…</code></td><td>{k.createdAt.toLocaleDateString("de-CH")}</td><td>{k.lastUsedAt ? k.lastUsedAt.toLocaleString("de-CH") : "nie"}</td>
                <td>{k.revokedAt ? "widerrufen" : <form action={revoke}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={k.id} /><button className="btn secondary">Widerrufen</button></form>}</td></tr>
            ))}
          </tbody></table>
        ) : <p className="muted">Noch kein Schlüssel.</p>}
      </section>
      <section className="card stack">
        <h2>Für die Webagentur</h2>
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
        <p className="small muted">Noch nicht enthalten: Webhooks, Zusatzleistungen und Gutscheine in der Dokumentation (Felder <code>extras</code>, <code>voucher_code</code> gehen, sind hier nicht beschrieben).</p>
      </section>
    </div>
  );
}
