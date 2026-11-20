import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { CONFIGURABLE_AREAS, ROLE_LABEL } from "@/src/domain/roles";
import { listMembers, removeMember } from "@/src/services/settings";
import { changeMemberRole, deleteRole, listRoles, ROLE_TEMPLATES, saveRole, setMemberRole, STANDARD_ROLES, TeamError } from "@/src/services/team";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (hotelId: string, msg: string, anchor = ""): never => redirect(`/mypontivo/${hotelId}/team?msg=${encodeURIComponent(msg)}${anchor}`);

async function run(f: FormData, ok: string, fn: (c: Awaited<ReturnType<typeof requireHotel>>) => Promise<void>, anchor = "") {
  const c = await requireHotel(s(f, "hotelId"), "owner");
  try {
    await fn(c);
  } catch (e) {
    if (e instanceof TeamError) back(c.hotel.id, `Nicht gespeichert: ${e.message}`, anchor);
    if (e instanceof ZodError) back(c.hotel.id, `Nicht gespeichert: ${e.issues.map((i) => i.message).join(", ")}`, anchor);
    throw e;
  }
  back(c.hotel.id, ok, anchor);
}

async function memberAdd(f: FormData) {
  "use server";
  await run(f, "Person hinzugefügt", ({ hotel, actor }) => setMemberRole(hotel.id, s(f, "email"), s(f, "role") || "staff", actor));
}
async function memberRole(f: FormData) {
  "use server";
  await run(f, "Rolle geändert", async ({ hotel, actor, user }) => {
    if (s(f, "userId") === user.id) throw new TeamError("Die eigene Rolle ändern Sie nicht selbst (damit der Betrieb nie ohne Inhaber ist).");
    await changeMemberRole(hotel.id, s(f, "userId"), s(f, "role"), actor);
  });
}
async function memberRemove(f: FormData) {
  "use server";
  await run(f, "Person entfernt", async ({ hotel, actor, user }) => {
    if (s(f, "userId") === user.id) throw new TeamError("Sie können sich nicht selbst entfernen.");
    await removeMember(hotel.id, s(f, "userId"), actor);
  });
}
async function roleSave(f: FormData) {
  "use server";
  const id = s(f, "roleId") || null;
  await run(f, id ? "Rolle gespeichert" : "Rolle angelegt", ({ hotel, actor }) => saveRole(hotel.id, id, { name: s(f, "name"), areas: f.getAll("area").map(String) }, actor).then(() => undefined), "#rollen");
}
async function roleDelete(f: FormData) {
  "use server";
  await run(f, "Rolle gelöscht", ({ hotel, actor }) => deleteRole(hotel.id, s(f, "roleId"), actor), "#rollen");
}

const GROUPS = [...new Set(CONFIGURABLE_AREAS.map((a) => a.group))];

function AreaChecks({ selected }: { selected: readonly string[] }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      {GROUPS.map((g) => (
        <fieldset key={g} className="plain">
          <legend className="small muted">{g}</legend>
          <div className="weekdays">
            {CONFIGURABLE_AREAS.filter((a) => a.group === g).map((a) => (
              <label key={a.key}><input type="checkbox" name="area" value={a.key} defaultChecked={selected.includes(a.key)} />{a.label}</label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

const labelOf = (a: string) => CONFIGURABLE_AREAS.find((x) => x.key === a)?.label ?? a;

/** Team: Personen und Rollen mit frei wählbaren Seiten. Nur Inhaber. */
export default async function Team({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, user } = await requireHotel(hotelId, "owner");
  const [members, roles] = await Promise.all([listMembers(hotel.id), listRoles(hotel.id)]);
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;
  const template = ROLE_TEMPLATES.find((t) => t.key === sp.vorlage);
  const nameOf = (role: string) => (role.startsWith("custom:") ? roles.find((r) => `custom:${r.id}` === role)?.name ?? "Rolle gelöscht" : ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? role);
  const roleOptions = (
    <>
      <optgroup label="Standardrollen">
        {STANDARD_ROLES.map((k) => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}
      </optgroup>
      {roles.length ? <optgroup label="Eigene Rollen">{roles.map((r) => <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>)}</optgroup> : null}
    </>
  );

  return (
    <div className="stack">
      <h1>Team</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}

      <section className="card stack" id="personen">
        <h2>Personen</h2>
        <table className="table">
          <thead><tr><th>E-Mail</th><th>Rolle</th><th></th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user.id}>
                <td>{m.user.email}{m.user.id === user.id ? <span className="muted small"> (Sie)</span> : null}</td>
                <td>
                  {m.user.id === user.id ? nameOf(m.role) : (
                    <form action={memberRole} className="inline-form" style={{ gap: 6 }}>
                      {hidden}<input type="hidden" name="userId" value={m.user.id} />
                      <select name="role" defaultValue={m.role} aria-label={`Rolle von ${m.user.email}`}>{roleOptions}</select>
                      <button className="btn secondary small">Ändern</button>
                    </form>
                  )}
                </td>
                <td>{m.user.id === user.id ? null : <form action={memberRemove}>{hidden}<input type="hidden" name="userId" value={m.user.id} /><button className="btn secondary small">Entfernen</button></form>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={memberAdd} className="inline-form">
          {hidden}
          <div><label>E-Mail</label><input name="email" type="email" required /></div>
          <div><label>Rolle</label><select name="role" defaultValue="staff">{roleOptions}</select></div>
          <button className="btn">Hinzufügen</button>
        </form>
        <p className="muted small" style={{ margin: 0 }}>Die Person meldet sich mit dieser E-Mail-Adresse an (Link per Mail oder Passkey).</p>
      </section>

      <section className="card stack" id="rollen">
        <h2>Rollen und Seiten</h2>
        <p className="muted small" style={{ margin: 0 }}>
          <strong>Inhaber</strong>: alles. <strong>Manager</strong>: alles ausser Team und Zahlungskonto. <strong>Mitarbeitende</strong>: Kalender und Buchungen lesen, No-Show.
          Die Standardrollen unten sind fest. Wenn eine Person andere Seiten braucht, legen Sie eine eigene Rolle an – am einfachsten aus einer Vorlage – und haken die Seiten an.
          Seiten zum Ändern von Preisen, Einstellungen und Team bleiben Inhaber und Manager vorbehalten.
        </p>
        <table className="table">
          <thead><tr><th>Standardrolle</th><th>Sieht</th></tr></thead>
          <tbody>
            {ROLE_TEMPLATES.map((t) => (
              <tr key={t.key}><td>{t.label}</td><td className="small">{t.areas.map(labelOf).join(", ")}</td></tr>
            ))}
          </tbody>
        </table>

        {roles.map((r) => (
          <details key={r.id} className="card">
            <summary><strong>{r.name}</strong> <span className="muted small">· {r.areas.length} Seite{r.areas.length === 1 ? "" : "n"} · {members.filter((m) => m.role === `custom:${r.id}`).length} Person(en)</span></summary>
            <form action={roleSave} className="stack" style={{ marginTop: 12 }}>
              {hidden}<input type="hidden" name="roleId" value={r.id} />
              <div style={{ maxWidth: 320 }}><label>Name der Rolle</label><input name="name" defaultValue={r.name} required maxLength={40} /></div>
              <AreaChecks selected={r.areas} />
              <div className="inline-form"><button className="btn small">Rolle speichern</button></div>
            </form>
            <form action={roleDelete} style={{ marginTop: 8 }}>{hidden}<input type="hidden" name="roleId" value={r.id} /><button className="btn secondary small">Rolle löschen</button></form>
          </details>
        ))}

        <details className="card" id="neu" open={!!template || undefined}>
          <summary><strong>+ Eigene Rolle anlegen</strong></summary>
          <form action={roleSave} className="stack" style={{ marginTop: 12 }}>
            {hidden}
            <div style={{ maxWidth: 320 }}><label>Name der Rolle</label><input name="name" required maxLength={40} placeholder="z. B. Nachtportier" defaultValue={template ? `${template.label} (angepasst)` : ""} /></div>
            <p className="muted small" style={{ margin: 0 }}>
              Vorlage übernehmen: {ROLE_TEMPLATES.map((t, i) => <span key={t.key}>{i ? " · " : ""}<a href={`?vorlage=${t.key}#neu`}>{t.label}</a></span>)}. Danach Seiten an- oder abhaken.
            </p>
            <AreaChecks selected={template?.areas ?? []} />
            <div><button className="btn small">Rolle anlegen</button></div>
          </form>
        </details>
      </section>
    </div>
  );
}
