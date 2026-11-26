import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { PosError, openOrder, tablesOverview, webDevice } from "@/src/services/pos";
import { formatChf } from "@/src/domain/money";
import { listAreas, listPlanItems, listWaiters } from "@/src/services/floorplan";
import { FloorPlan } from "@/components/admin/FloorPlan";
import { reservationsOfDay } from "@/src/services/reservations";
import { todayIn } from "@/src/domain/dates";
import { toMin } from "@/src/domain/reservations";
import { formatInTimeZone } from "date-fns-tz";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";

async function open(f: FormData) {
  "use server";
  const c = await requireHotelModule("pos", s(f, "hotelId"), "staff", "restaurant");
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
  const { hotel } = await requireHotelModule("pos", hotelId, "staff", "restaurant");
  const [tables, areas, planItems, waiters] = await Promise.all([tablesOverview(hotel.id), listAreas(hotel.id), listPlanItems(hotel.id), listWaiters(hotel.id)]);
  const today = todayIn(hotel.timezone);
  const nowMin = Number(formatInTimeZone(new Date(), hotel.timezone, "H")) * 60 + Number(formatInTimeZone(new Date(), hotel.timezone, "m"));
  const todays = (await reservationsOfDay(hotel.id, today)).filter((r) => r.status === "confirmed");
  /** nächste Reservierung am Tisch, die in den nächsten 90 Minuten beginnt oder schon läuft */
  const nextRes = (tableId: string) => todays.find((r) => r.tableId === tableId && toMin(r.time) + 90 > nowMin && toMin(r.time) < nowMin + 90);
  const planned = tables.filter(({ table }) => table.planX !== null && table.planY !== null);
  return (
    <div className="stack">
      <h1>Restaurant</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      {planned.length ? (
        <FloorPlan waiters={waiters.map((w) => ({ id: w.id, name: w.name, color: w.color }))} areas={areas.map((a) => ({ id: a.id, name: a.name }))} items={planItems.filter((i) => areas.some((a) => a.id === i.areaId)).map((i) => ({ id: i.id, kind: i.kind, label: i.label, x: i.planX, y: i.planY, w: i.w, h: i.h, areaId: i.areaId }))}
          reservations={todays.slice().sort((a, b) => toMin(a.time) - toMin(b.time)).map((r) => ({ id: r.id, time: r.time, name: r.name, party: r.party, tableId: r.tableId, extraTableIds: r.extraTableIds, status: r.status }))} tables={planned.map(({ table, orders }) => { const r = nextRes(table.id); const open = orders.reduce((a, o) => a + o.openRappen, 0); return {
          id: table.id, name: table.name, seats: table.seats, shape: table.shape, x: table.planX, y: table.planY, areaId: table.areaId, waiterId: table.waiterId,
          tone: orders.length ? "busy" as const : r ? "soon" as const : "free" as const,
          info: orders.length ? formatChf(open) : r ? `${r.time} ${r.name}` : "frei",
          href: orders[0] ? `/admin/${hotel.id}/restaurant/bestellung/${orders[0].order.id}` : undefined,
        }; })} />
      ) : null}
      <p className="small"><Link href={`/admin/${hotel.id}/restaurant/reservierungen`}>Reservierungen heute: {todays.length}</Link></p>
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
      ) : <p className="muted">Noch keine Tische. Ein Manager legt sie unter Einstellungen → Gastronomie → Tischplan & Reservierung online an. Bestellungen ohne Tisch gehen trotzdem.</p>}
      <form action={open} className="card stack">
        <input type="hidden" name="hotelId" value={hotel.id} />
        <div><label htmlFor="label">Ohne Tisch (z. B. «Bar», «Take-away Meier»)</label><input id="label" name="label" maxLength={60} /></div>
        <div><button className="btn">Bestellung eröffnen</button></div>
      </form>
    </div>
  );
}
