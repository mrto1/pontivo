import { redirect } from "next/navigation";
import { requireUser } from "@/src/auth/guard";
import { hotelsForUser } from "@/src/auth/session";
import { portfolio } from "@/src/services/portfolio";
import { formatChf } from "@/src/domain/money";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { draft: "in Einrichtung", live: "online", paused: "pausiert" };

export default async function AdminHome() {
  const user = await requireUser();
  const list = await hotelsForUser(user.id);
  if (list.length === 1 && !user.isPlatformAdmin) redirect(`/admin/${list[0].hotel.id}`);
  const rows = await portfolio(list);
  const roles = new Map(list.map((l) => [l.hotel.id, l.role]));
  const total = rows.reduce((s, r) => s + r.monthRevenueRappen, 0);
  const canAdd = !user.isPlatformAdmin && list.some((l) => l.role === "owner");
  return (
    <main className="wrap admin-main">
      <h1>{user.isPlatformAdmin ? "Alle Betriebe" : "Meine Betriebe"}</h1>
      {rows.length ? (
        <table className="table">
          <thead><tr><th>Betrieb</th><th>Status</th><th>Anreisen heute</th><th>Abreisen heute</th><th>Im Haus</th><th>Neue Anfragen</th><th>Buchungen Monat</th><th>Umsatz Monat</th><th>Rolle</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.hotelId}>
                <td><a href={`/admin/${r.hotelId}`}>{r.name}</a>{r.setupOpen ? <span className="badge warn" style={{ marginLeft: 8 }}>Einrichtung offen</span> : null}</td>
                <td>{STATUS[r.status] ?? r.status}</td>
                <td>{r.arrivals}</td><td>{r.departures}</td><td>{r.inHouse}</td>
                <td>{r.newInquiries > 0 ? <a href={`/admin/${r.hotelId}/inquiries`}><strong>{r.newInquiries}</strong></a> : 0}</td>
                <td>{r.monthBookings}</td><td>{formatChf(r.monthRevenueRappen)}</td>
                <td>{roles.get(r.hotelId)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 ? <tfoot><tr><td colSpan={7}><strong>Total Umsatz diesen Monat</strong></td><td colSpan={2}><strong>{formatChf(total)}</strong></td></tr></tfoot> : null}
        </table>
      ) : (
        <p className="muted">Noch kein Betrieb. Neue Betriebe registrieren sich unter <a href="/registrieren">/registrieren</a>.</p>
      )}
      <p className="small muted">Umsatz = bestätigte Buchungen dieses Monats (nach Bestätigungsdatum), ohne Abzüge.</p>
      {canAdd ? <p><a className="btn secondary small" href="/admin/neu">Weiteren Betrieb anlegen</a></p> : null}
      <form action="/api/auth/logout" method="post" style={{ marginTop: 24 }}><button className="btn secondary small">Abmelden</button></form>
    </main>
  );
}
