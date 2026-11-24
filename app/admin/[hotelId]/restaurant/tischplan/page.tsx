import { FloorPlan } from "@/components/admin/FloorPlan";
import { PeriodNav } from "@/components/admin/PeriodNav";
import { formatInTimeZone } from "date-fns-tz";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { moduleRows } from "@/src/services/modules";
import { isOn } from "@/src/domain/modules";
import { listTables, tablesOverview } from "@/src/services/pos";
import { getSettings, reservationsOfDay } from "@/src/services/reservations";
import { addDays, isDay, todayIn } from "@/src/domain/dates";
import { TIME_RE, toMin } from "@/src/domain/reservations";
import { formatDay } from "@/src/i18n/dict";
import { formatChf } from "@/src/domain/money";
import { atLeast, hasArea } from "@/src/domain/roles";

export const dynamic = "force-dynamic";
const SOON_MIN = 30;

/** Tischplan mit Reservierungszustand (SPEC 20.1): frei, reserviert (bald), am Tisch; mit Kasse auch offene Bestellungen */
export default async function ReservationPlan({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotelModule("restaurant", hotelId, "staff", "resplan");
  const base = `/admin/${hotel.id}`;
  const today = todayIn(hotel.timezone);
  const day = sp.day && isDay(sp.day) ? sp.day : today;
  const nowTime = formatInTimeZone(new Date(), hotel.timezone, "HH:mm");
  const time = sp.time && TIME_RE.test(sp.time) ? sp.time : day === today ? nowTime : "19:00";
  const pos = isOn(await moduleRows(hotel.id), "pos") && hasArea(role, "restaurant") && day === today;
  const [tables, list, cfg, open] = await Promise.all([listTables(hotel.id), reservationsOfDay(hotel.id, day), getSettings(hotel.id), pos ? tablesOverview(hotel.id) : Promise.resolve([])]);
  const t0 = toMin(time);
  const live = list.filter((r) => r.status === "confirmed" || r.status === "seated" || r.status === "pending");
  // Reservierung, die zur gewählten Zeit läuft (Tisch belegt bis Ende) und die nächste danach (Tisch frei bis dahin)
  const now = (id: string) => live.find((r) => r.tableId === id && toMin(r.time) <= t0 && toMin(r.time) + cfg.durationMin > t0);
  const next = (id: string) => live.filter((r) => r.tableId === id && toMin(r.time) > t0).sort((a, b) => toMin(a.time) - toMin(b.time))[0];
  const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const minSeats = Math.max(0, Math.floor(Number(sp.seats) || 0));
  const maxSeats = Math.max(0, ...tables.map((t) => t.seats));
  const openBy = new Map(open.map((o) => [o.table.id, o.orders]));
  const planned = tables.filter((t) => t.planX !== null && t.planY !== null);
  return (
    <div className="stack">
      <h1 className="sr-only">Tischplan</h1>
      <PeriodNav prev={`?day=${addDays(day, -1)}&time=${time}&seats=${minSeats}`} next={`?day=${addDays(day, 1)}&time=${time}&seats=${minSeats}`} todayHref="?" todayActive={day === today} prevLabel="Vortag" nextLabel="Folgetag" jump={{ value: day, param: "day", keep: { time, seats: String(minSeats) } }}>
        <form method="get" className="plan-filter"><input type="hidden" name="day" value={day} />
          <div><label htmlFor="time" className="small">Zeit</label><input id="time" name="time" type="time" step={900} defaultValue={time} /></div>
          <div><label htmlFor="seats" className="small">Plätze</label><select id="seats" name="seats" defaultValue={String(minSeats)}><option value="0">alle</option>{Array.from({ length: maxSeats }, (_, i) => i + 1).map((n) => <option key={n} value={n}>ab {n}</option>)}</select></div>
          <button className="btn secondary">Zeigen</button></form>
      </PeriodNav>
      <p className="small muted" style={{ margin: 0 }}>{formatDay(day, "de")}, {time} · grün frei (mit Uhrzeit, bis wann) · orange belegt oder in weniger als 30 Minuten reserviert · rot am Tisch{pos ? " oder offene Bestellung" : ""}</p>
      {planned.length ? (
        <FloorPlan tables={planned.map((t) => {
          const cur = now(t.id); const nxt = next(t.id); const orders = openBy.get(t.id) ?? [];
          const busy = orders.length > 0 || (cur?.status === "seated");
          // ASSUMPTION: «bald» (orange) heisst: nächste Reservierung in weniger als 30 Minuten; sonst bleibt der Tisch grün mit «frei bis HH:MM».
          const soon = nxt && toMin(nxt.time) < t0 + SOON_MIN;
          const freeUntil = nxt ? nxt.time : null;
          const endCur = cur ? hhmm(toMin(cur.time) + cfg.durationMin) : null;
          const detail: string[] = [];
          if (orders.length) detail.push(`Offene Bestellung: ${formatChf(orders.reduce((a, o) => a + o.openRappen, 0))}`);
          if (cur) detail.push(`${cur.status === "seated" ? "Am Tisch" : "Reserviert"}: ${cur.name}, ${cur.party} Pers., ${cur.time} bis ${endCur}`);
          if (nxt) detail.push(`${cur ? "Danach" : "Nächste"} Reservierung: ${nxt.time} ${nxt.name}, ${nxt.party} Pers.${cur ? "" : ` (Tisch bis dahin frei)`}`);
          if (!cur && !nxt && !orders.length) detail.push("Frei für den Rest des Tages.");
          return {
            id: t.id, name: t.name, seats: t.seats, shape: t.shape, x: t.planX, y: t.planY,
            tone: busy ? "busy" as const : cur || soon ? "soon" as const : "free" as const,
            dim: t.seats < minSeats,
            info: orders.length ? "offen" : cur ? `bis ${endCur}` : freeUntil ? `frei bis ${freeUntil}` : undefined,
            detail,
            href: orders[0] ? `${base}/restaurant/bestellung/${orders[0].order.id}` : cur || nxt ? `${base}/restaurant/reservierungen?day=${day}` : undefined,
            hrefLabel: orders[0] ? "Bestellung öffnen" : "Reservierungen des Tages",
          };
        })} />
      ) : <p className="muted">Noch kein Tischplan.{atLeast(role, "manager") ? <> <a href={`${base}/restaurant/tische`}>Tische im Plan platzieren</a></> : null}</p>}
    </div>
  );
}
