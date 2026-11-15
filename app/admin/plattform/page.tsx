import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/src/auth/guard";
import { deleteHotelCascade, deleteUserAccount, platformOverview, resetUserSecurity } from "@/src/services/platform-admin";
import { getHotelById } from "@/src/services/hotels";
import { addMember, removeMember, setHotelStatus } from "@/src/services/settings";
import { requestLoginLink } from "@/src/auth/session";
import { ROLE_LABEL, type Role } from "@/src/domain/roles";

export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleDateString("de-CH");

const back = (msg: string, key: "done" | "error" = "done") => redirect(`/admin/plattform?${key}=${encodeURIComponent(msg)}`);

async function hotelStatus(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const hotel = await getHotelById(String(formData.get("id") ?? ""));
  const status = String(formData.get("status"));
  if (!hotel || !["live", "paused"].includes(status)) back("Betrieb nicht gefunden", "error");
  try { await setHotelStatus(hotel!, status as "live" | "paused", `user:${admin.id}`); } catch (e) { back((e as Error).message, "error"); }
  back(`«${hotel!.name}»: ${status === "live" ? "wieder online" : "pausiert"}`);
}

async function memberAdd(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const role = String(formData.get("role")) as Role;
  try { await addMember(String(formData.get("hotelId")), String(formData.get("email")), role, `user:${admin.id}`); } catch (e) { back((e as Error).message, "error"); }
  back("Mitglied gespeichert (der Zugang erfolgt über die Anmeldung mit dieser E-Mail)");
}

async function memberRemove(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  await removeMember(String(formData.get("hotelId")), String(formData.get("userId")), `user:${admin.id}`);
  back("Mitgliedschaft entfernt");
}

async function securityReset(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  await resetUserSecurity(String(formData.get("id")), `user:${admin.id}`);
  back("Sicherheit zurückgesetzt: Passkeys, Authenticator und Wiederherstellungscodes entfernt");
}

async function sendLink(formData: FormData) {
  "use server";
  await requirePlatformAdmin();
  const link = await requestLoginLink(String(formData.get("email")));
  back(link ? "Login-Link per E-Mail gesendet" : "Kein Link möglich (Konto unbekannt oder «Nur Passkey» aktiv; zuerst Sicherheit zurücksetzen)", link ? "done" : "error");
}

async function removeHotel(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const id = String(formData.get("id") ?? "");
  const { hotels } = await platformOverview();
  const h = hotels.find((x) => x.id === id);
  if (!h) redirect("/admin/plattform");
  // Löschen nur, wenn der Name genau eingetippt wurde
  if (String(formData.get("confirm") ?? "").trim() !== h.name) redirect("/admin/plattform?error=confirm");
  await deleteHotelCascade(id, `user:${admin.id}`);
  redirect(`/admin/plattform?done=${encodeURIComponent(`Betrieb «${h.name}» gelöscht`)}`);
}

async function removeUser(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const id = String(formData.get("id") ?? "");
  const { users } = await platformOverview();
  const u = users.find((x) => x.id === id);
  if (!u || u.isPlatformAdmin || u.id === admin.id) redirect("/admin/plattform?error=user");
  if (String(formData.get("confirm") ?? "").trim().toLowerCase() !== u.email.toLowerCase()) redirect("/admin/plattform?error=confirm");
  await deleteUserAccount(id, `user:${admin.id}`);
  redirect(`/admin/plattform?done=${encodeURIComponent(`Benutzer ${u.email} gelöscht`)}`);
}

export default async function Plattform({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const { hotels, users } = await platformOverview();
  return (
    <main className="wrap admin-main">
      <p><a href="/admin">← Übersicht</a></p>
      <h1>Plattform-Verwaltung</h1>
      <p className="muted">Nur für Pontivo-Admins. Löschen ist endgültig und nimmt alle Daten mit (Buchungen, Rechnungen, Gäste, Mails). Zur Bestätigung den Namen bzw. die E-Mail eintippen.</p>
      {sp.done ? <p className="notice">{sp.done}</p> : null}
      {sp.error && sp.error !== "confirm" && sp.error !== "user" ? <p className="notice warn">{sp.error}</p> : null}
      {sp.error === "confirm" ? <p className="notice warn">Bestätigung stimmt nicht, nichts gelöscht.</p> : null}
      {sp.error === "user" ? <p className="notice warn">Dieser Benutzer kann nicht gelöscht werden (Plattform-Admin oder man selbst).</p> : null}

      <h2>Betriebe ({hotels.length})</h2>
      <table>
        <thead><tr><th>Betrieb</th><th>Status</th><th>Mitglieder</th><th>Buchungen</th><th>Rechnungen</th><th>Angelegt</th><th>Löschen</th></tr></thead>
        <tbody>
          {hotels.map((h) => (
            <tr key={h.id}>
              <td><a href={`/admin/${h.id}`}>{h.name}</a></td>
              <td>
                {h.status}
                {h.status === "live" || h.status === "paused" ? (
                  <form action={hotelStatus}>
                    <input type="hidden" name="id" value={h.id} />
                    <input type="hidden" name="status" value={h.status === "live" ? "paused" : "live"} />
                    <button className="btn secondary small">{h.status === "live" ? "Pausieren" : "Wieder online"}</button>
                  </form>
                ) : null}
              </td>
              <td className="small">
                {h.members.map((m) => (
                  <form key={m.userId} action={memberRemove} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="hidden" name="hotelId" value={h.id} /><input type="hidden" name="userId" value={m.userId} />
                    <span>{m.email} ({ROLE_LABEL[m.role as Role] ?? m.role})</span>
                    <button className="linklike" title="Mitgliedschaft entfernen">entfernen</button>
                  </form>
                ))}
                <details>
                  <summary>Mitglied hinzufügen</summary>
                  <form action={memberAdd} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <input type="hidden" name="hotelId" value={h.id} />
                    <input name="email" type="email" placeholder="E-Mail" required aria-label="E-Mail" />
                    <select name="role" aria-label="Rolle">{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                    <button className="btn secondary small">Hinzufügen</button>
                  </form>
                </details>
              </td>
              <td>{h.bookings}</td>
              <td>{h.invoices}</td>
              <td>{fmt(h.createdAt)}</td>
              <td>
                <form action={removeHotel} style={{ display: "flex", gap: 6 }}>
                  <input type="hidden" name="id" value={h.id} />
                  <input name="confirm" placeholder="Namen eintippen" aria-label={`Namen von ${h.name} zur Bestätigung`} required />
                  <button className="btn secondary small">Löschen</button>
                </form>
                {h.status === "live" || h.invoices > 0 ? <span className="small muted">Achtung: Rechnungen müssen in der Schweiz 10 Jahre aufbewahrt werden.</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Benutzer ({users.length})</h2>
      <p className="small muted">Ein gelöschter Benutzer verliert seine Zugänge. Seine Betriebe bleiben bestehen (vorher ggf. den Betrieb löschen).</p>
      <table>
        <thead><tr><th>E-Mail</th><th>Betriebe</th><th>Sicherheit</th><th>Angelegt</th><th>Löschen</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}{u.isPlatformAdmin ? " (Plattform-Admin)" : ""}</td>
              <td className="small">{u.hotels.map((h) => `${h.name} (${h.role})`).join(", ") || "–"}</td>
              <td className="small">
                {u.passkeys} Passkey{u.passkeys === 1 ? "" : "s"}{u.totp ? ", 2FA" : ""}{u.emailLoginDisabled ? ", nur Passkey" : ""}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <form action={sendLink}><input type="hidden" name="email" value={u.email} /><button className="linklike">Login-Link senden</button></form>
                  {u.passkeys || u.totp || u.emailLoginDisabled ? <form action={securityReset}><input type="hidden" name="id" value={u.id} /><button className="linklike">Sicherheit zurücksetzen</button></form> : null}
                </div>
              </td>
              <td>{fmt(u.createdAt)}</td>
              <td>
                {u.isPlatformAdmin ? "–" : (
                  <form action={removeUser} style={{ display: "flex", gap: 6 }}>
                    <input type="hidden" name="id" value={u.id} />
                    <input name="confirm" placeholder="E-Mail eintippen" aria-label={`E-Mail von ${u.email} zur Bestätigung`} required />
                    <button className="btn secondary small">Löschen</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
