import { Notice } from "@/components/admin/Notice";
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
  await requireModule(c.hotel.id, "posbridge");
  try {
    const { key } = await createApiKey(c.hotel.id, s(f, "label"), c.actor);
    // Der Schlüssel wird nur dieses eine Mal angezeigt (Adresse, nicht gespeichert)
    redirect(`/mypontivo/${c.hotel.id}/posbridge?new=${encodeURIComponent(key)}`);
  } catch (e) {
    if (!(e instanceof PosBridgeError)) throw e;
    redirect(`/mypontivo/${c.hotel.id}/posbridge?msg=${encodeURIComponent(`Nicht erstellt: ${e.message}`)}`);
  }
}
async function revoke(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "owner");
  await requireModule(c.hotel.id, "posbridge");
  await revokeApiKey(c.hotel.id, s(f, "id"), c.actor);
  redirect(`/mypontivo/${c.hotel.id}/posbridge?msg=${encodeURIComponent("Schlüssel widerrufen.")}`);
}

export default async function PosBridgePage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "owner");
  await requireModule(hotel.id, "posbridge");
  const keys = await listApiKeys(hotel.id);
  const url = `${env().APP_BASE_URL}/api/v1/folio-items`;
  return (
    <div className="stack">
      <h1>Kassen-Schnittstelle</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <p className="muted">Wer seine Restaurantkasse behält, bucht Posten über diese Schnittstelle aufs Zimmer. Die Posten erscheinen in der Hotelrechnung der Buchung.</p>
      {sp.new ? (
        <div className="card stack">
          <h2>Neuer Schlüssel</h2>
          <p className="notice warn">Bitte jetzt kopieren und an den Kassenanbieter geben. Er wird nur einmal angezeigt.</p>
          <p><code style={{ wordBreak: "break-all" }}>{sp.new}</code></p>
        </div>
      ) : null}
      <form action={create} className="card stack">
        <input type="hidden" name="hotelId" value={hotel.id} />
        <div><label htmlFor="label">Bezeichnung (z. B. Name der Kasse)</label><input id="label" name="label" required maxLength={80} /></div>
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
        <h2>Für den Kassenanbieter</h2>
        <p><code>POST {url}</code><br />Header: <code>Authorization: Bearer pnt_…</code>, <code>Content-Type: application/json</code></p>
        <pre style={{ overflow: "auto" }}>{`{
  "room_number": "12",            // oder "booking_reference": "PNT-ABC123"
  "description": "Abendessen",
  "quantity": 1,
  "unit_price_rappen": 4850,      // ganze Rappen, negativ für Gutschrift
  "vat": "standard",              // standard | stay | none
  "external_id": "KASSE-2026-000123"
}`}</pre>
        <p className="small muted">Antwort 201 = gebucht, 200 = Wiederholung derselben Beleg-ID (nichts doppelt), 404 = kein Gast im Zimmer, 409 = mehrdeutig oder Beleg-ID mit anderem Inhalt, 401 = Schlüssel ungültig, 429 = zu viele Anfragen.</p>
      </section>
    </div>
  );
}
