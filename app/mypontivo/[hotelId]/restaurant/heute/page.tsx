import Link from "next/link";
import { requireHotel } from "@/src/auth/guard";
import { requireModule, moduleRows } from "@/src/services/modules";
import { isOn } from "@/src/domain/modules";
import { listTables, tablesOverview } from "@/src/services/pos";
import { reservationsOfDay, waitlistOfDay } from "@/src/services/reservations";
import { todayIn } from "@/src/domain/dates";
import { formatDay } from "@/src/i18n/dict";
import { formatChf } from "@/src/domain/money";
import { atLeast, hasArea } from "@/src/domain/roles";
import { diningChecklist } from "@/src/services/onboarding";

export const dynamic = "force-dynamic";
const STATUS = { pending: "Zahlung offen", confirmed: "erwartet", seated: "am Tisch", cancelled: "storniert", noshow: "nicht erschienen" } as const;

/** Tagesübersicht der Gastronomie (SPEC 20.1): Reservierungen von heute, Warteliste, offene Tische, Hinweise */
export default async function DiningToday({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, role } = await requireHotel(hotelId, "staff", "dininghome");
  await requireModule(hotel.id, "restaurant");
  const base = `/mypontivo/${hotel.id}`;
  const today = todayIn(hotel.timezone);
  const rows = await moduleRows(hotel.id);
  const pos = isOn(rows, "pos") && hasArea(role, "restaurant");
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
  const checklist = manager ? await diningChecklist(hotel) : [];
  const openItems = checklist.filter((c) => !c.done && c.key !== "domain");
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Heute</h1>
      <p className="muted" style={{ margin: 0 }}>{formatDay(today, "de")}</p>
      {checklist.length ? (
        <details className="card stack" open={openItems.length > 0} data-testid="ready-checklist">
          <summary><strong>Bereit für den Betrieb</strong> <span className="small muted">{checklist.filter((c) => c.done).length} von {checklist.length} erledigt</span></summary>
          <ul className="list" style={{ marginTop: 8 }}>
            {checklist.map((c) => (
              <li key={c.key}>
                <span aria-hidden="true">{c.done ? "✓" : c.wait ? "⏳" : "○"}</span> {c.done ? c.title : <a href={c.href}>{c.title}</a>}
                {c.wait ? <span className="badge warn" style={{ marginLeft: 6 }}>in Prüfung</span> : null}
                {!c.done && c.hint ? <div className="small muted">{c.hint}</div> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="hk-summary" aria-label="Übersicht" data-testid="dining-summary">
        <span className="hk-stat"><b>{live.length}</b> Reservierungen</span>
        <span className="hk-stat"><b>{guests}</b> Gäste</span>
        <span className="hk-stat"><b>{expected.length}</b> noch erwartet</span>
        <span className="hk-stat"><b>{seated.length}</b> am Tisch</span>
        {wait.length ? <a className="hk-stat" href={`${base}/restaurant/warteliste`}><b>{wait.length}</b> auf der Warteliste</a> : null}
      </div>
      <section className="card stack">
        <h2 style={{ margin: 0 }}>Reservierungen heute</h2>
        {live.length ? (
          <div className="scroll-x"><table className="table" data-testid="dining-today">
            <thead><tr><th>Zeit</th><th>Pers.</th><th>Gast</th><th>Tisch</th><th>Status</th></tr></thead>
            <tbody>{live.map((r) => (
              <tr key={r.id}><td>{r.time}</td><td>{r.party}</td><td>{r.name}{r.note ? <div className="small muted">{r.note}</div> : null}</td><td>{r.tableId ? tname.get(r.tableId) ?? "–" : "–"}</td><td>{STATUS[r.status]}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted small" style={{ margin: 0 }}>Keine Reservierungen.</p>}
        <p className="small" style={{ margin: 0 }}><Link href={`${base}/restaurant/reservierungen`}>Alle Reservierungen und neue erfassen →</Link></p>
      </section>
      {pos ? (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Offene Tische</h2>
          {openTables.length ? (
            <ul className="list">{openTables.map((t) => <li key={t.table.id}><a href={`${base}/restaurant/bestellung/${t.orders[0].order.id}`}>{t.table.name}</a> · {formatChf(t.orders.reduce((a, o) => a + o.openRappen, 0))}</li>)}</ul>
          ) : <p className="muted small" style={{ margin: 0 }}>Kein Tisch offen.</p>}
        </section>
      ) : null}
    </div>
  );
}
