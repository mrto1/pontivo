import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/src/auth/guard";
import { deleteHotelCascade, deleteUserAccount, platformOverview, resetUserSecurity } from "@/src/services/platform-admin";
import { getHotelById } from "@/src/services/hotels";
import { addMember, removeMember, setHotelStatus } from "@/src/services/settings";
import { requestLoginLink } from "@/src/auth/session";
import { roleLabel, ROLE_LABEL, type Role } from "@/src/domain/roles";
import { getPlatformVat, savePlatformVat } from "@/src/services/platform-settings";
import { listPlatformInvoices, retryCharge, processCharges } from "@/src/services/billing";
import { formatChf } from "@/src/domain/money";
import { formatBps } from "@/src/domain/invoice";
import { todayIn } from "@/src/domain/dates";

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

async function saveVat(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const on = formData.get("liable") === "on";
  try {
    await savePlatformVat({ liableFrom: on ? String(formData.get("from") ?? "") : null, bps: Math.round(Number(String(formData.get("rate") ?? "8.1").replace(",", ".")) * 100), number: String(formData.get("number") ?? "") }, `user:${admin.id}`);
  } catch (e) { back((e as Error).message, "error"); }
  back(on ? "MWST-Pflicht gespeichert: gilt für Rechnungen ab dem eingetragenen Datum (Leistungsmonat)" : "MWST-Pflicht ausgeschaltet: neue Rechnungen ohne MWST");
}

async function retryInvoice(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const ok = await retryCharge(String(formData.get("id")), `user:${admin.id}`);
  if (ok) await processCharges();
  back(ok ? "Belastung nochmals versucht" : "Nichts zu wiederholen", ok ? "done" : "error");
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
  const vat = await getPlatformVat();
  const invoices = await listPlatformInvoices();
  const STATUS: Record<string, string> = { live: "online", draft: "Entwurf", paused: "pausiert" };
  return (
    <main className="wrap admin-main">
      <div className="stack" style={{ gap: 24 }}>
        <header className="stack" style={{ gap: 6 }}>
          <h1 style={{ margin: 0 }}>Plattform-Verwaltung</h1>
          <p className="muted small" style={{ margin: 0 }}>Nur für Pontivo-Admins. Löschen ist endgültig und nimmt alle Daten mit (Buchungen, Rechnungen, Gäste, Mails). Zur Bestätigung den Namen bzw. die E-Mail eintippen.</p>
        </header>
        {sp.done ? <p className="notice">{sp.done}</p> : null}
        {sp.error && sp.error !== "confirm" && sp.error !== "user" ? <p className="notice warn">{sp.error}</p> : null}
        {sp.error === "confirm" ? <p className="notice warn">Bestätigung stimmt nicht, nichts gelöscht.</p> : null}
        {sp.error === "user" ? <p className="notice warn">Dieser Benutzer kann nicht gelöscht werden (Plattform-Admin oder man selbst).</p> : null}

        <section className="card stack" id="mwst">
          <h2 style={{ margin: 0 }}>MWST der Plattform</h2>
          <p className="muted small" style={{ margin: 0 }}>Ab wann ist {`Lynxora`} MWST-pflichtig? Ab diesem Datum weisen neue Rechnungen an die Betriebe die MWST aus und belasten sie zusätzlich (die Preise verstehen sich ohne MWST, Bedingungen für Gastgeber Ziffer 2). Massgebend ist der letzte Tag des Leistungsmonats; beginnt die Pflicht mitten im Monat, gilt sie für den ganzen Monat. Bereits ausgestellte Rechnungen ändern sich nicht.</p>
          <form action={saveVat} className="stack" style={{ maxWidth: 460 }}>
            <label className="check"><input type="checkbox" name="liable" defaultChecked={!!vat.liableFrom} /> MWST-pflichtig</label>
            <label>ab Datum<input type="date" name="from" defaultValue={vat.liableFrom ?? todayIn("Europe/Zurich")} /></label>
            <label>Satz in % (Normalsatz seit 2024: 8,1)<input name="rate" inputMode="decimal" defaultValue={String(vat.bps / 100)} /></label>
            <label>MWST-Nummer<input name="number" placeholder="CHE-123.456.789 MWST" defaultValue={vat.number} /></label>
            <div><button className="btn">Speichern</button></div>
          </form>
          <p className="small">{vat.liableFrom ? <>Aktuell: <strong>MWST-pflichtig ab {vat.liableFrom}</strong>, Satz {formatBps(vat.bps)}.</> : <>Aktuell: <strong>nicht MWST-pflichtig</strong>, Rechnungen ohne MWST.</>}</p>
        </section>

        <section className="stack" id="rechnungen">
          <h2 style={{ margin: 0 }}>Rechnungen an die Betriebe</h2>
          {invoices.length === 0 ? <p className="muted small">Noch keine. Der Worker erstellt sie am 1. des Monats für den Vormonat.</p> : (
            <table className="table small">
              <thead><tr><th>Nr.</th><th>Betrieb</th><th>Monat</th><th>Netto</th><th>MWST</th><th>Belastet</th><th>Status</th><th></th></tr></thead>
              <tbody>{invoices.map(({ c, hotelName }) => (
                <tr key={c.id}>
                  <td>{c.invoiceNo ? <a href={`/mypontivo/${c.hotelId}/plattform-rechnung/${c.id}`} target="_blank">{c.invoiceNo}</a> : "–"}</td>
                  <td>{hotelName}</td><td>{c.month}</td><td>{formatChf(c.netRappen)}</td><td>{c.vatRappen ? formatChf(c.vatRappen) : "–"}</td><td>{formatChf(c.chargeRappen)}</td>
                  <td>{c.status === "succeeded" ? "bezahlt" : c.status === "none" ? "nichts fällig" : c.status === "pending" ? "offen" : <span className="badge warn">fehlgeschlagen ({c.attempts}×)</span>}</td>
                  <td>{c.status === "failed" ? <form action={retryInvoice}><input type="hidden" name="id" value={c.id} /><button className="btn secondary">Erneut versuchen</button></form> : null}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>

        <section className="stack" id="betriebe">
          <h2 style={{ margin: 0 }}>Betriebe ({hotels.length})</h2>
          {hotels.map((h) => (
            <article key={h.id} className="card stack">
              <div className="plat-head">
                <div>
                  <h3 style={{ margin: 0 }}><a href={`/mypontivo/${h.id}`}>{h.name}</a> <span className={`badge${h.status === "live" ? "" : " warn"}`}>{STATUS[h.status] ?? h.status}</span></h3>
                  <p className="muted small" style={{ margin: "4px 0 0" }}>{h.bookings} Buchungen · {h.invoices} Rechnungen · angelegt {fmt(h.createdAt)}</p>
                </div>
                {h.status === "live" || h.status === "paused" ? (
                  <form action={hotelStatus}>
                    <input type="hidden" name="id" value={h.id} />
                    <input type="hidden" name="status" value={h.status === "live" ? "paused" : "live"} />
                    <button className="btn secondary small">{h.status === "live" ? "Pausieren" : "Wieder online"}</button>
                  </form>
                ) : null}
              </div>

              <div className="stack" style={{ gap: 8 }}>
                <h4 className="plat-label">Team</h4>
                {h.members.length ? (
                  <ul className="plat-list">
                    {h.members.map((m) => (
                      <li key={m.userId}>
                        <span>{m.email} <span className="muted small">· {roleLabel(m.role as Role)}</span></span>
                        <form action={memberRemove}>
                          <input type="hidden" name="hotelId" value={h.id} /><input type="hidden" name="userId" value={m.userId} />
                          <button className="btn secondary small" title="Mitgliedschaft entfernen">Entfernen</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted small" style={{ margin: 0 }}>Noch niemand.</p>}
                <form action={memberAdd} className="form-row">
                  <input type="hidden" name="hotelId" value={h.id} />
                  <div><label>E-Mail</label><input name="email" type="email" placeholder="name@beispiel.ch" required /></div>
                  <div><label>Rolle</label><select name="role">{(Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
                  <div><button className="btn small">Hinzufügen</button></div>
                </form>
              </div>

              <details className="plat-danger">
                <summary>Betrieb löschen</summary>
                <form action={removeHotel} className="form-row" style={{ marginTop: 10 }}>
                  <input type="hidden" name="id" value={h.id} />
                  <div><label>Zur Bestätigung den Namen eintippen</label><input name="confirm" placeholder={h.name} aria-label={`Namen von ${h.name} zur Bestätigung`} required /></div>
                  <div><button className="btn secondary small">Endgültig löschen</button></div>
                </form>
                {h.status === "live" || h.invoices > 0 ? <p className="small muted" style={{ margin: "8px 0 0" }}>Achtung: Rechnungen müssen in der Schweiz 10 Jahre aufbewahrt werden.</p> : null}
              </details>
            </article>
          ))}
        </section>

        <section className="stack" id="benutzer">
          <h2 style={{ margin: 0 }}>Benutzer ({users.length})</h2>
          <p className="small muted" style={{ margin: 0 }}>Ein gelöschter Benutzer verliert seine Zugänge. Seine Betriebe bleiben bestehen (vorher ggf. den Betrieb löschen).</p>
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
                        <form action={sendLink}><input type="hidden" name="email" value={u.email} /><button className="btn secondary small">Login-Link senden</button></form>
                        {u.passkeys || u.totp || u.emailLoginDisabled ? <form action={securityReset}><input type="hidden" name="id" value={u.id} /><button className="btn secondary small">Sicherheit zurücksetzen</button></form> : null}
                      </div>
                    </td>
                    <td>{fmt(u.createdAt)}</td>
                    <td>
                      {u.isPlatformAdmin ? <span className="muted">–</span> : (
                        <details className="plat-danger">
                          <summary>Löschen</summary>
                          <form action={removeUser} className="stack" style={{ marginTop: 8, minWidth: 220 }}>
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
        </section>
      </div>
    </main>
  );
}
