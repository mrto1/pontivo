import { FloorPlan } from "@/components/admin/FloorPlan";
import { PeriodNav } from "@/components/admin/PeriodNav";
import { formatInTimeZone } from "date-fns-tz";
import { requireHotel } from "@/src/auth/guard";
import { moduleRows, requireModule } from "@/src/services/modules";
import { isOn } from "@/src/domain/modules";
import { listTables, tablesOverview } from "@/src/services/pos";
import { getSettings, reservationsOfDay } from "@/src/services/reservations";
import { addDays, isDay, todayIn } from "@/src/domain/dates";
import { TIME_RE, toMin } from "@/src/domain/reservations";
import { formatDay } from "@/src/i18n/dict";
import { formatChf } from "@/src/domain/money";
import { atLeast, hasArea } from "@/src/domain/roles";

export const dynamic = "force-dynamic";

/** Tischplan mit Reservierungszustand (SPEC 20.1): frei, reserviert (bald), am Tisch; mit Kasse auch offene Bestellungen */
export default async function ReservationPlan({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "staff", "resplan");
  await requireModule(hotel.id, "restaurant");
  const base = `/admin/${hotel.id}`;
  const today = todayIn(hotel.timezone);
  const day = sp.day && isDay(sp.day) ? sp.day : today;
  const nowTime = formatInTimeZone(new Date(), hotel.timezone, "HH:mm");
  const time = sp.time && TIME_RE.test(sp.time) ? sp.time : day === today ? nowTime : "19:00";
  const pos = isOn(await moduleRows(hotel.id), "pos") && hasArea(role, "restaurant") && day === today;
  const [tables, list, cfg, open] = await Promise.all([listTables(hotel.id), reservationsOfDay(hotel.id, day), getSettings(hotel.id), pos ? tablesOverview(hotel.id) : Promise.resolve([])]);
  const t0 = toMin(time);
  const live = list.filter((r) => r.status === "confirmed" || r.status === "seated" || r.status === "pending");
  // Reservierung am Tisch, die zur gewählten Zeit läuft oder in den nächsten 90 Minuten beginnt
  const at = (id: string) => live.find((r) => r.tableId === id && toMin(r.time) < t0 + 90 && toMin(r.time) + cfg.durationMin > t0);
  const openBy = new Map(open.map((o) => [o.table.id, o.orders]));
  const planned = tables.filter((t) => t.planX !== null && t.planY !== null);
  return (
    <div className="stack">
      <h1>Tischplan</h1>
      <PeriodNav prev={`?day=${addDays(day, -1)}&time=${time}`} next={`?day=${addDays(day, 1)}&time=${time}`} todayHref="?" todayActive={day === today} prevLabel="Vortag" nextLabel="Folgetag" jump={{ value: day, param: "day", keep: { time } }}>
        <form method="get" className="inline-form"><input type="hidden" name="day" value={day} /><label htmlFor="time" className="small">Zeit</label><input id="time" name="time" type="time" step={900} defaultValue={time} /><button className="btn secondary small">Zeigen</button></form>
      </PeriodNav>
      <p className="small muted" style={{ margin: 0 }}>{formatDay(day, "de")}, {time} · grün frei · orange reserviert · rot am Tisch{pos ? " oder offene Bestellung" : ""}</p>
      {planned.length ? (
        <FloorPlan tables={planned.map((t) => {
          const r = at(t.id); const orders = openBy.get(t.id) ?? [];
          const busy = orders.length > 0 || (r?.status === "seated");
          return {
            id: t.id, name: t.name, seats: t.seats, shape: t.shape, x: t.planX, y: t.planY,
            tone: busy ? "busy" as const : r ? "soon" as const : "free" as const,
            info: orders.length ? formatChf(orders.reduce((a, o) => a + o.openRappen, 0)) : r ? `${r.time} ${r.name} (${r.party})` : "frei",
            href: orders[0] ? `${base}/restaurant/bestellung/${orders[0].order.id}` : r ? `${base}/restaurant/reservierungen?day=${day}` : undefined,
          };
        })} />
      ) : <p className="muted">Noch kein Tischplan.{atLeast(role, "manager") ? <> <a href={`${base}/restaurant/einstellungen`}>Tische im Plan platzieren</a></> : null}</p>}
    </div>
  );
}
