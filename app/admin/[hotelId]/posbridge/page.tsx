import { Notice } from "@/components/admin/Notice";
import { InfoTip } from "@/components/admin/InfoTip";
import { redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { PosBridgeError, bridgeTotals, createApiKey, listApiKeys, revokeApiKey } from "@/src/services/posbridge";
import { formatChf } from "@/src/domain/money";
import { env } from "@/src/env";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";

async function create(f: FormData) {
  "use server";
  const c = await requireHotelModule("posbridge", s(f, "hotelId"), "owner");
  try {
    const { key } = await createApiKey(c.hotel.id, s(f, "label"), c.actor);
    // Der Schlüssel wird nur dieses eine Mal angezeigt (Adresse, nicht gespeichert)
    redirect(`/admin/${c.hotel.id}/posbridge?new=${encodeURIComponent(key)}`);
  } catch (e) {
    if (!(e instanceof PosBridgeError)) throw e;
    redirect(`/admin/${c.hotel.id}/posbridge?msg=${encodeURIComponent(`Nicht erstellt: ${e.message}`)}`);
  }
}
async function revoke(f: FormData) {
  "use server";
  const c = await requireHotelModule("posbridge", s(f, "hotelId"), "owner");
  await revokeApiKey(c.hotel.id, s(f, "id"), c.actor);
  redirect(`/admin/${c.hotel.id}/posbridge?msg=${encodeURIComponent("Schlüssel widerrufen.")}`);
}

export default async function PosBridgePage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("posbridge", hotelId, "owner");
  const [keys, totals] = await Promise.all([listApiKeys(hotel.id), bridgeTotals(hotel.id)]);
  const keyLabel = new Map(keys.map((k) => [k.id, k.label]));
  const url = `${env().APP_BASE_URL}/api/v1/folio-items`;
  return (
    <div className="stack">
      <h1>Kassen-Schnittstelle</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <div><InfoTip label="Worum geht es hier?">Wer seine Restaurantkasse behält, bucht Posten über diese Schnittstelle aufs Zimmer. Die Posten erscheinen in der Hotelrechnung der Buchung.</InfoTip></div>
      {sp.new ? (
        <div className="card stack">
          <h2>Neuer Schlüssel</h2>
          <p className="notice warn">Bitte jetzt kopieren und an den Kassenanbieter geben. Er wird nur einmal angezeigt.</p>
          <p><code className="break-all">{sp.new}</code></p>
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
      {totals.length ? (
        <section className="card stack" data-testid="bridge-totals">
          <h2>Gebuchte Posten je Monat</h2>
          <p className="small muted">Was Kassen über die Schnittstelle aufs Zimmer gebucht haben, z. B. Ihr Pächter. Grundlage für die Abrechnung mit ihm.</p>
          <table className="table small"><thead><tr><th>Monat</th><th>Schlüssel</th><th>Posten</th><th>Betrag</th></tr></thead>
            <tbody>{totals.map((t) => <tr key={`${t.month}-${t.keyId}`}><td>{t.month}</td><td>{keyLabel.get(t.keyId) ?? t.keyId}</td><td>{t.count}</td><td>{formatChf(t.totalRappen)}</td></tr>)}</tbody></table>
        </section>
      ) : null}
      <section className="card stack">
        <h2>Verpachtetes Restaurant mit Pontivo</h2>
        <p className="small">Führt Ihr Pächter seine Kasse ebenfalls mit Pontivo, geben Sie ihm einen Schlüssel. Er trägt ihn unter «Gastronomie → Kasse → Kassen-Geräte → Hotel verbinden» ein. Seine Kasse zeigt dann Ihre Gäste im Haus (Zimmer, Nachname und Initiale) und bucht «aufs Zimmer» direkt auf Ihre Hotelrechnung. Widerrufen Sie den Schlüssel, endet die Verbindung sofort.</p>
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
        <p className="small">Gäste im Haus: <code>GET {`${env().APP_BASE_URL}/api/v1/in-house`}</code> mit demselben Schlüssel, Antwort <code>{`{ "guests": [{ "booking_reference", "room", "name" }] }`}</code> (Name als «Nachname V.»).</p>
        <p className="small muted">Antwort 201 = gebucht, 200 = Wiederholung derselben Beleg-ID (nichts doppelt), 404 = kein Gast im Zimmer, 409 = mehrdeutig oder Beleg-ID mit anderem Inhalt, 401 = Schlüssel ungültig, 429 = zu viele Anfragen.</p>
      </section>
    </div>
  );
}
