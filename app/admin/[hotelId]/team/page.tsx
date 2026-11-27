import { Notice } from "@/components/admin/Notice";
import Link from "next/link";
import { Drawer, DrawerActions } from "@/components/admin/Drawer";
import { RowList } from "@/components/admin/RowList";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { CONFIGURABLE_AREAS, ROLE_LABEL } from "@/src/domain/roles";
import { listMembers, removeMember } from "@/src/services/settings";
import { changeMemberRole, deleteRole, listRoles, listStandardRoles, resetStandardRole, ROLE_TEMPLATES, saveRole, saveStandardRole, setMemberRole, STANDARD_ROLES, TeamError } from "@/src/services/team";
import { s } from "@/src/lib/form";
import { hotelAction, type HotelCtx } from "@/src/lib/hotel-action";

export const dynamic = "force-dynamic";

/** `reopen`: bei einem Fehler bleibt diese Seitenleiste offen */
const run = (f: FormData, ok: string, fn: (c: HotelCtx) => Promise<void>, anchor = "", reopen = "") =>
  hotelAction(f, { page: "team", role: "owner", ok, anchor, reopen: reopen ? { rolle: reopen } : undefined }, fn);

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
  await run(f, id ? "Rolle gespeichert" : "Rolle angelegt", ({ hotel, actor }) => saveRole(hotel.id, id, { name: s(f, "name"), areas: f.getAll("area").map(String) }, actor).then(() => undefined), "#rollen", id ?? "neu");
}
async function roleDelete(f: FormData) {
  "use server";
  await run(f, "Rolle gelöscht", ({ hotel, actor }) => deleteRole(hotel.id, s(f, "roleId"), actor), "#rollen");
}

async function standardSave(f: FormData) {
  "use server";
  await run(f, "Standardrolle gespeichert", ({ hotel, actor }) => saveStandardRole(hotel.id, s(f, "role"), { name: s(f, "name"), areas: f.getAll("area").map(String) }, actor), "#rollen", `std:${s(f, "role")}`);
}
async function standardReset(f: FormData) {
  "use server";
  await run(f, "Auf die Vorgabe zurückgesetzt", ({ hotel, actor }) => resetStandardRole(hotel.id, s(f, "role"), actor), "#rollen");
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


/** Team: Personen und Rollen mit frei wählbaren Seiten. Nur Inhaber. */
export default async function Team({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, user } = await requireHotel(hotelId, "owner");
  const [members, roles, standard] = await Promise.all([listMembers(hotel.id), listRoles(hotel.id), listStandardRoles(hotel.id)]);
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;
  const template = ROLE_TEMPLATES.find((t) => t.key === sp.vorlage);
  const nameOf = (role: string) => (role.startsWith("custom:") ? roles.find((r) => `custom:${r.id}` === role)?.name ?? "Rolle gelöscht" : standard.find((x) => x.key === role)?.name ?? ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? role);
  const roleOptions = (
    <>
      <optgroup label="Standardrollen">
        {STANDARD_ROLES.map((k) => <option key={k} value={k}>{nameOf(k)}</option>)}
      </optgroup>
      {roles.length ? <optgroup label="Eigene Rollen">{roles.map((r) => <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>)}</optgroup> : null}
    </>
  );

  const key = sp.rolle ?? "";
  const std = key.startsWith("std:") ? standard.find((t) => t.key === key.slice(4)) ?? null : null;
  const own = key && key !== "neu" && !std ? roles.find((r) => r.id === key) ?? null : null;
  const drawer = key === "neu" || !!std || !!own;
  const close = `/admin/${hotel.id}/team#rollen`;
  return (
    <div className="stack">
      <h1>Team & Rollen</h1>
      {sp.msg && !drawer ? <Notice text={sp.msg} /> : null}
      {drawer ? (
        <Drawer title={std ? `${std.name} (Standardrolle)` : own ? own.name : "Eigene Rolle anlegen"} closeHref={close}>
          {sp.msg ? <Notice text={sp.msg} /> : null}
          {std ? (
            <>
              <form action={standardSave} className="stack">
                {hidden}<input type="hidden" name="role" value={std.key} />
                <div className="mw320"><label htmlFor="tr-name">Name der Rolle</label><input id="tr-name" name="name" defaultValue={std.name} required maxLength={40} /></div>
                <AreaChecks selected={std.areas} />
                <DrawerActions submit="Speichern" cancelHref={close} />
              </form>
              {std.custom ? <form action={standardReset}>{hidden}<input type="hidden" name="role" value={std.key} /><button className="btn secondary small">Auf Vorgabe zurücksetzen</button></form> : null}
            </>
          ) : (
            <>
              <form action={roleSave} className="stack">
                {hidden}{own ? <input type="hidden" name="roleId" value={own.id} /> : null}
                <div className="mw320"><label htmlFor="tr-name">Name der Rolle</label><input id="tr-name" name="name" required maxLength={40} placeholder="z. B. Nachtportier" defaultValue={own?.name ?? (template ? `${template.label} (angepasst)` : "")} /></div>
                {own ? null : <p className="muted small m0">Vorlage übernehmen: {ROLE_TEMPLATES.map((t, i) => <span key={t.key}>{i ? " · " : ""}<Link href={`?rolle=neu&vorlage=${t.key}`} scroll={false}>{t.label}</Link></span>)}. Danach Seiten an- oder abhaken.</p>}
                <AreaChecks selected={own?.areas ?? template?.areas ?? []} />
                <DrawerActions submit={own ? "Rolle speichern" : "Rolle anlegen"} cancelHref={close} />
              </form>
              {own ? <form action={roleDelete}>{hidden}<input type="hidden" name="roleId" value={own.id} /><ConfirmButton ask={`Rolle «${own.name}» wirklich löschen?`} className="btn secondary small danger-text">Rolle löschen</ConfirmButton></form> : null}
            </>
          )}
        </Drawer>
      ) : null}

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
                    <form action={memberRole} className="inline-form gap6">
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
          <div><label htmlFor="fb48d1">E-Mail</label><input id="fb48d1" name="email" type="email" required /></div>
          <div><label htmlFor="fb48d2">Rolle</label><select id="fb48d2" name="role" defaultValue="staff">{roleOptions}</select></div>
          <button className="btn">Hinzufügen</button>
        </form>
        <p className="muted small m0">Die Person meldet sich mit dieser E-Mail-Adresse an (Link per Mail oder Passkey).</p>
      </section>

      <section className="card stack" id="rollen">
        <h2>Rollen und Seiten</h2>
        <p className="muted small m0">
          <strong>Inhaber</strong>: alles. <strong>Manager</strong>: alles ausser Team und Zahlungskonto. <strong>Mitarbeitende</strong>: Kalender und Buchungen lesen, No-Show.
          Die Standardrollen können Sie für Ihren Betrieb anpassen (Name und Seiten), eigene Rollen legen Sie dazu.
          Seiten zum Ändern von Preisen, Einstellungen und Team bleiben Inhaber und Manager vorbehalten.
        </p>

        <RowList rows={[
          ...standard.map((t) => ({ id: `std:${t.key}`, href: `?rolle=std:${t.key}#rollen`, label: `Rolle ${t.name} bearbeiten`, title: t.name, detail: `Standardrolle${t.custom ? ", angepasst" : ""} · ${t.areas.length} Seiten · ${members.filter((m) => m.role === t.key).length} Person(en)` })),
          ...roles.map((r) => ({ id: r.id, href: `?rolle=${r.id}#rollen`, label: `Rolle ${r.name} bearbeiten`, title: r.name, detail: `Eigene Rolle · ${r.areas.length} Seite${r.areas.length === 1 ? "" : "n"} · ${members.filter((m) => m.role === `custom:${r.id}`).length} Person(en)` })),
        ]} />
        <div><Link className="btn secondary" href="?rolle=neu#rollen" scroll={false}>+ Eigene Rolle anlegen</Link></div>
      </section>
    </div>
  );
}
