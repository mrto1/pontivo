import { redirect } from "next/navigation";
import Link from "next/link";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosError, openOrder, tablesOverview, webDevice } from "@/src/services/pos";
import { formatChf } from "@/src/domain/money";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function open(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "staff", "restaurant");
  await requireModule(c.hotel.id, "pos");
  const dev = await webDevice(c.hotel.id);
  try {
    const o = await openOrder(c.hotel.id, { tableId: s(f, "tableId") || null, deviceId: dev.id, label: s(f, "label") }, c.actor);
    redirect(`/admin/${c.hotel.id}/restaurant/bestellung/${o.id}`);
  } catch (e) {
    if (!(e instanceof PosError)) throw e;
    redirect(`/admin/${c.hotel.id}/restaurant?msg=${encodeURIComponent(`Nicht eröffnet: ${e.message}`)}`);
  }
}

export default async function RestaurantPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "staff", "restaurant");
  await requireModule(hotel.id, "pos");
  const tables = await tablesOverview(hotel.id);
  return (
    <div className="stack">
      <h1>Restaurant</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      {tables.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
          {tables.map(({ table, orders }) => (
            <div key={table.id} className="card stack">
              <strong>{table.name}</strong>
              {orders.map((o) => <Link key={o.order.id} className="btn secondary small" href={`/admin/${hotel.id}/restaurant/bestellung/${o.order.id}`}>offen {formatChf(o.openRappen)}</Link>)}
              <form action={open}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="tableId" value={table.id} /><button className="btn small">{orders.length ? "Weitere Bestellung" : "Eröffnen"}</button></form>
            </div>
          ))}
        </div>
      ) : <p className="muted">Noch keine Tische. Ein Manager legt sie unter «Artikel» an. Bestellungen ohne Tisch gehen trotzdem.</p>}
      <form action={open} className="card stack">
        <input type="hidden" name="hotelId" value={hotel.id} />
        <div><label htmlFor="label">Ohne Tisch (z. B. «Bar», «Take-away Meier»)</label><input id="label" name="label" maxLength={60} /></div>
        <div><button className="btn">Bestellung eröffnen</button></div>
      </form>
    </div>
  );
}
