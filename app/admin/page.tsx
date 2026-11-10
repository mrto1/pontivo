import { redirect } from "next/navigation";
import { requireUser } from "@/src/auth/guard";
import { hotelsForUser } from "@/src/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const user = await requireUser();
  const list = await hotelsForUser(user.id);
  if (list.length === 1 && !user.isPlatformAdmin) redirect(`/admin/${list[0].hotel.id}`);
  return (
    <main className="wrap admin-main">
      <h1>Hotels</h1>
      <table className="table">
        <thead><tr><th>Hotel</th><th>Status</th><th>Domain</th><th>Rolle</th></tr></thead>
        <tbody>
          {list.map(({ hotel, role }) => (
            <tr key={hotel.id}>
              <td><a href={`/admin/${hotel.id}`}>{hotel.name}</a></td>
              <td>{hotel.status}</td>
              <td>{hotel.primaryDomain ?? "–"}</td>
              <td>{role}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length === 0 ? <p className="muted">Noch kein Betrieb. Neue Betriebe registrieren sich unter <a href="/registrieren">/registrieren</a>.</p> : null}
      <form action="/api/auth/logout" method="post" style={{ marginTop: 24 }}><button className="btn secondary small">Abmelden</button></form>
    </main>
  );
}
