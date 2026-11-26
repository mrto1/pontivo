import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { Notice } from "@/components/admin/Notice";
import { requireHotelModule } from "@/src/auth/guard";
import { PosError, listTables } from "@/src/services/pos";
import { ensureQrToken, reviewUrl, saveReviewUrl } from "@/src/services/table-pay";
import { publicUrl } from "@/src/services/online-orders";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";
const here = (h: string, msg: string) => redirect(`/admin/${h}/restaurant/tisch-qr?msg=${encodeURIComponent(msg)}`);

async function saveReview(f: FormData) {
  "use server";
  const c = await requireHotelModule("restaurant", s(f, "hotelId"), "manager");
  try { await saveReviewUrl(c.hotel.id, s(f, "url"), c.actor); } catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, `Nicht gespeichert: ${e.message}`); }
  here(c.hotel.id, "Bewertungs-Link gespeichert.");
}

/** QR-Codes für die Tische (SPEC 19.55): Gäste bezahlen am Tisch, geben Trinkgeld und bewerten */
export default async function TableQrAdmin({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("restaurant", hotelId, "manager");
  const tables = await listTables(hotel.id);
  const ready = !!(hotel.stripeAccountId && hotel.stripeChargesEnabled);
  const items = await Promise.all(tables.map(async (t) => {
    const url = `${publicUrl(hotel)}/de/am-tisch/${await ensureQrToken(hotel.id, t.id)}`;
    return { t, url, img: await QRCode.toDataURL(url, { margin: 1, width: 180 }) };
  }));
  return (
    <div className="stack">
      <h1>Tisch-QR</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      {!ready ? <p className="notice warn">Zahlungen sind noch nicht freigegeben (Stripe). Der QR-Code zeigt dann «Bezahlen am Tisch ist hier nicht eingerichtet».</p> : null}
      <p className="small muted">Jeder Tisch hat einen eigenen QR-Code. Der Gast sieht die offenen Posten seines Tisches, wählt aus, gibt Trinkgeld und bezahlt mit TWINT, Karte oder Wallet. Das Trinkgeld wird dem Kellner des Tisches zugeordnet; der Bon erscheint in der Kasse. Auf diese Zahlungen erhebt Pontivo keine Plattformgebühr.</p>
      <form action={saveReview} className="card stack"><input type="hidden" name="hotelId" value={hotel.id} />
        <h2>Bewertung nach dem Bezahlen</h2>
        <p className="small muted">Der Gast bewertet mit Sternen. Ab 4 Sternen bieten wir den Link zu Google an, darunter geht die Rückmeldung nur an Sie.</p>
        <div><label htmlFor="url">Link zur Google-Bewertung</label><input id="url" name="url" type="url" defaultValue={await reviewUrl(hotel.id)} placeholder="https://g.page/r/…/review" /></div>
        <div><button className="btn secondary">Speichern</button></div>
      </form>
      {items.length ? (
        <div className="tq-admin-grid" data-testid="qr-list">
          {items.map(({ t, url, img }) => (
            <div key={t.id} className="card stack tq-admin-card">
              <strong>{t.name}</strong>
              <img src={img} alt={`QR-Code ${t.name}`} width={180} height={180} />
              <a className="small" href={url} target="_blank" rel="noopener noreferrer">Seite öffnen</a>
            </div>
          ))}
        </div>
      ) : <p className="muted">Noch keine Tische. <a href={`/admin/${hotel.id}/restaurant/tische`}>Tische anlegen</a></p>}
      <p className="small muted">Zum Ausdrucken die Seite mit dem Druckdialog des Browsers drucken.</p>
    </div>
  );
}
