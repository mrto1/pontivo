import Link from "next/link";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { moduleRows } from "@/src/services/modules";
import { isOn } from "@/src/domain/modules";
import { listTables, tablesOverview } from "@/src/services/pos";
import { reservationsOfDay, waitlistOfDay } from "@/src/services/reservations";
import { addDays, isDay, todayIn } from "@/src/domain/dates";
import { PeriodNav } from "@/components/admin/PeriodNav";
import { formatDay } from "@/src/i18n/dict";
import { formatChf } from "@/src/domain/money";
import { atLeast, hasArea } from "@/src/domain/roles";
import { diningChecklist } from "@/src/services/onboarding";
import { cashByDriver, orderSettings, screenOrders } from "@/src/services/online-orders";

export const dynamic = "force-dynamic";
const STATUS = { pending: "Zahlung offen", confirmed: "erwartet", seated: "am Tisch", cancelled: "storniert", noshow: "nicht erschienen" } as const;

/** Tagesübersicht der Gastronomie (SPEC 20.1): Reservationen von heute, Warteliste, offene Tische, Hinweise */
export default async function DiningToday({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotelModule("restaurant", hotelId, "staff", "dininghome");
  const base = `/admin/${hotel.id}`;
  const realToday = todayIn(hotel.timezone);
  const today = sp.day && isDay(sp.day) ? sp.day : realToday; // Tag wählbar wie in der Tagesliste des Hotels
  const isToday = today === realToday;
  const here = `${base}/restaurant/heute`;
  const rows = await moduleRows(hotel.id);
  const pos = isToday && isOn(rows, "pos") && hasArea(role, "restaurant");
  const [list, wait, tables, open] = await Promise.all([
    reservationsOfDay(hotel.id, today), waitlistOfDay(hotel.id, today), listTables(hotel.id),
    pos ? tablesOverview(hotel.id) : Promise.resolve([]),
  ]);
  const tname = new Map(tables.map((t) => [t.id, t.name]));
  const live = list.filter((r) => r.status === "confirmed" || r.status === "seated" || r.status === "pending");
  const guests = live.reduce((a, r) => a + r.party, 0);
  const expected = live.filter((r) => r.status === "confirmed");
  const seated = live.filter((r) => r.status === "seated");
  const openTables = open.filter((t) => t.orders.length);
  const manager = atLeast(role, "manager");
  // Checkliste «Bereit für den Betrieb» (Konzept 7a): jeder offene Schritt mit Link, Wartezeiten mit Hinweis
  const checklist = manager && isToday ? await diningChecklist(hotel) : [];
  const openItems = checklist.filter((c) => !c.done && c.key !== "domain" && c.key !== "bestellung");
  // Online-Bestellungen (SPEC 20.4/20.5): offene und Bargeld je Fahrer
  const ordersOn = isToday && hasArea(role, "onlineorders") && (await orderSettings(hotel.id)).enabled;
  const [orders, cash] = ordersOn ? await Promise.all([screenOrders(hotel.id), manager ? cashByDriver(hotel) : Promise.resolve([])]) : [null, []];
  return (
    <div className="stack">
      <h1 className="sr-only">{isToday ? "Heute" : "Tagesübersicht"}</h1>
      <PeriodNav prev={`${here}?day=${addDays(today, -1)}`} next={`${here}?day=${addDays(today, 1)}`} todayHref={here} todayActive={isToday} prevLabel="Vortag" nextLabel="Folgetag" jump={{ value: today, param: "day" }} />
      <p className="day-line">{isToday ? "Heute, " : ""}{formatDay(today, "de")}</p>
      {checklist.length ? (
        <details className="card ready" open={openItems.length > 0} data-testid="ready-checklist">
          <summary>
            <span><strong>Bereit für den Betrieb</strong></span>
            <span className="small muted">{checklist.filter((c) => c.done).length} von {checklist.length} erledigt</span>
          </summary>
          <div className="wizard-bar" role="progressbar" aria-valuemin={0} aria-valuemax={checklist.length} aria-valuenow={checklist.filter((c) => c.done).length}><span style={{ width: `${(checklist.filter((c) => c.done).length / checklist.length) * 100}%` }} /></div>
          <ul className="ready-list">
            {checklist.map((c) => (
              <li key={c.key} className={c.done ? "done" : c.wait ? "wait" : ""}>
                <span className="dot" aria-hidden="true">{c.done ? "✓" : c.wait ? "…" : ""}</span>
                <span className="ready-text">
                  {c.done ? <span className="muted">{c.title}</span> : <a href={c.href}>{c.title}</a>}
                  {c.wait ? <span className="badge warn">in Prüfung</span> : null}
                  {!c.done && c.hint ? <span className="small muted ready-hint">{c.hint}</span> : null}
                </span>
                {c.done ? null : <a className="ready-go" href={c.href} aria-hidden="true" tabIndex={-1}>→</a>}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="hk-summary" aria-label="Übersicht" data-testid="dining-summary">
        <span className="hk-stat"><b>{live.length}</b> Reservationen</span>
        <span className="hk-stat"><b>{guests}</b> Gäste</span>
        <span className="hk-stat"><b>{expected.length}</b> noch erwartet</span>
        <span className="hk-stat"><b>{seated.length}</b> am Tisch</span>
        {wait.length ? <a className="hk-stat" href={`${base}/restaurant/warteliste`}><b>{wait.length}</b> auf der Warteliste</a> : null}
      </div>
      <section className="card stack">
        <h2 className="m0">{isToday ? "Reservationen heute" : "Reservationen"}</h2>
        {live.length ? (
          <div className="scroll-x"><table className="table" data-testid="dining-today">
            <thead><tr><th>Zeit</th><th>Pers.</th><th>Gast</th><th>Tisch</th><th>Status</th></tr></thead>
            <tbody>{live.map((r) => (
              <tr key={r.id}><td>{r.time}</td><td>{r.party}</td><td>{r.name}{r.note ? <div className="small muted">{r.note}</div> : null}{r.preorder?.length ? <div className="small"><span className="badge">Vorbestellung</span> {r.preorder.map((l) => `${l.quantity}× ${l.description}`).join(", ")}</div> : null}</td><td>{r.tableId ? tname.get(r.tableId) ?? "–" : "–"}</td><td>{STATUS[r.status]}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted small m0">Keine Reservationen.</p>}
        <p className="small m0"><Link href={`${base}/restaurant/reservierungen`}>Alle Reservationen und neue erfassen →</Link></p>
      </section>
      {orders ? (
        <section className="card stack" data-testid="dining-orders">
          <h2 className="m0">Online-Bestellungen</h2>
          <p className="m0">{orders.open.filter((o) => o.status === "new").length ? <span className="badge danger">{orders.open.filter((o) => o.status === "new").length} neu</span> : null} {orders.open.length} offen · {orders.done.filter((o) => o.status === "completed").length} erledigt · <Link href={`${base}/restaurant/bestellungen`}>Bestellbildschirm →</Link></p>
          {cash.length ? (
            <table className="table"><caption className="small muted u-ta-left">Bargeld je Fahrer (Lieferungen bar, heute)</caption><tbody>
              {cash.map((c) => <tr key={c.driver}><td>{c.driver || "ohne Fahrer"}</td><td>{c.n} Lieferungen</td><td>{formatChf(c.total)}</td></tr>)}
            </tbody></table>
          ) : null}
        </section>
      ) : null}
      {pos ? (
        <section className="card stack">
          <h2 className="m0">Offene Tische</h2>
          {openTables.length ? (
            <ul className="list">{openTables.map((t) => <li key={t.table.id}><a href={`${base}/restaurant/bestellung/${t.orders[0].order.id}`}>{t.table.name}</a> · {formatChf(t.orders.reduce((a, o) => a + o.openRappen, 0))}</li>)}</ul>
          ) : <p className="muted small m0">Kein Tisch offen.</p>}
        </section>
      ) : null}
    </div>
  );
}
