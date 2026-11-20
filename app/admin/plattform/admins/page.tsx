import { requirePlatformAdmin } from "@/src/auth/guard";
import { platformOverview } from "@/src/services/platform-admin";
import { adminAdd, adminRemove } from "../actions";
import { Flash, PageHead } from "../Flash";

export const dynamic = "force-dynamic";
const TO = "/admin/plattform/admins";

export default async function Admins({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePlatformAdmin();
  const sp = await searchParams;
  const { users } = await platformOverview();
  const admins = users.filter((u) => u.isPlatformAdmin);
  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHead title={`Plattform-Admins (${admins.length})`}>Alle hier eingetragenen Personen sehen diese Verwaltung und alle Betriebe. Jede Person meldet sich mit ihrer eigenen E-Mail an (empfohlen: Passkey oder Authenticator unter Mein Konto). Jede Änderung steht im Protokoll.</PageHead>
      <Flash sp={sp} />
      <section className="card stack">
        <ul className="plat-list">
          {admins.map((u) => (
            <li key={u.id}>
              <span>{u.email}{u.name ? <span className="muted small"> · {u.name}</span> : null}{u.id === me.id ? <> <span className="badge">du</span></> : null} <span className="muted small">· {u.passkeys || u.totp ? "zweiter Faktor eingerichtet" : "nur E-Mail-Link"}</span></span>
              {u.id !== me.id ? <form action={adminRemove}><input type="hidden" name="to" value={TO} /><input type="hidden" name="id" value={u.id} /><button className="btn secondary small">Recht entziehen</button></form> : null}
            </li>
          ))}
        </ul>
        <form action={adminAdd} className="form-row">
          <input type="hidden" name="to" value={TO} />
          <div><label>E-Mail</label><input name="email" type="email" placeholder="name@pontivo.ch" required /></div>
          <div><label>Name (optional)</label><input name="name" /></div>
          <div><button className="btn small">Als Plattform-Admin hinzufügen</button></div>
        </form>
      </section>
    </div>
  );
}
