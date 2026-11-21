import { requirePlatformAdmin } from "@/src/auth/guard";
import { platformOverview } from "@/src/services/platform-admin";
import { removeUser, securityReset, sendLink } from "../actions";
import { Flash, PageHead } from "../Flash";

export const dynamic = "force-dynamic";
const TO = "/plattform/benutzer";
const fmt = (d: Date) => d.toLocaleDateString("de-CH");

export default async function Benutzer({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const { users } = await platformOverview();
  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHead title={`Benutzer (${users.length})`}>Ein gelöschter Benutzer verliert seine Zugänge. Seine Betriebe bleiben bestehen (vorher ggf. den Betrieb löschen).</PageHead>
      <Flash sp={sp} />
      <div className="card" style={{ padding: 0 }}>
        <table className="table" style={{ border: 0 }}>
          <thead><tr><th>E-Mail</th><th>Betriebe</th><th>Sicherheit</th><th>Angelegt</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}{u.isPlatformAdmin ? <> <span className="badge">Plattform-Admin</span></> : null}</td>
                <td className="small">{u.hotels.map((h) => `${h.name} (${h.role})`).join(", ") || "–"}</td>
                <td className="small">
                  <div>{u.passkeys} Passkey{u.passkeys === 1 ? "" : "s"}{u.totp ? ", 2FA" : ""}{u.emailLoginDisabled ? ", nur Passkey" : ""}</div>
                  <div className="plat-actions">
                    <form action={sendLink}><input type="hidden" name="to" value={TO} /><input type="hidden" name="email" value={u.email} /><button className="btn secondary small">Login-Link senden</button></form>
                    {u.passkeys || u.totp || u.emailLoginDisabled ? <form action={securityReset}><input type="hidden" name="to" value={TO} /><input type="hidden" name="id" value={u.id} /><button className="btn secondary small">Sicherheit zurücksetzen</button></form> : null}
                  </div>
                </td>
                <td>{fmt(u.createdAt)}</td>
                <td>
                  {u.isPlatformAdmin ? <span className="muted">–</span> : (
                    <details className="plat-danger">
                      <summary>Löschen</summary>
                      <form action={removeUser} className="stack" style={{ marginTop: 8, minWidth: 220 }}>
                        <input type="hidden" name="to" value={TO} />
                        <input type="hidden" name="id" value={u.id} />
                        <input name="confirm" placeholder={u.email} aria-label={`E-Mail von ${u.email} zur Bestätigung`} required />
                        <button className="btn secondary small">Endgültig löschen</button>
                      </form>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
