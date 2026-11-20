import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { hotelMembers, hotelRoleOverrides, hotelRoles, users } from "../db/schema";
import { CONFIGURABLE_AREAS, EDITABLE_STANDARD_ROLES, ROLE_AREAS, ROLE_LABEL, type FullRole, type LimitedRole } from "../domain/roles";
import { audit } from "./audit";

/** Team eines Betriebs: Mitglieder und frei konfigurierbare Rollen (nur Inhaber). Jede Abfrage nach hotel_id. */
export class TeamError extends Error {}

export const STANDARD_ROLES = Object.keys(ROLE_LABEL) as (FullRole | LimitedRole)[];

/** Vorlagen für eigene Rollen: die eingeschränkten Standardrollen mit ihren Seiten (ohne Rahmen-Bereiche) */
export const ROLE_TEMPLATES: { key: LimitedRole; label: string; areas: string[] }[] = (["reception", "housekeeping", "accounting", "service"] as LimitedRole[]).map((k) => ({
  key: k,
  label: ROLE_LABEL[k],
  areas: ROLE_AREAS[k].filter((a) => CONFIGURABLE_AREAS.some((c) => c.key === a)),
}));

const AREA_KEYS = new Set(CONFIGURABLE_AREAS.map((a) => a.key));
export const roleSchema = z.object({
  name: z.string().trim().min(2, "Name fehlt (mindestens 2 Zeichen)").max(40, "Name zu lang (höchstens 40 Zeichen)"),
  areas: z.array(z.string()).transform((a) => [...new Set(a.filter((k) => AREA_KEYS.has(k)))]),
});

export async function listRoles(hotelId: string) {
  return db().select().from(hotelRoles).where(eq(hotelRoles.hotelId, hotelId)).orderBy(asc(hotelRoles.name));
}

/** Vorgabe einer Standardrolle: Name und Seiten (nur konfigurierbare Seiten) */
const defaultsOf = (k: LimitedRole) => ({ name: ROLE_LABEL[k], areas: ROLE_AREAS[k].filter((a) => AREA_KEYS.has(a)) });

/** Die vier anpassbaren Standardrollen eines Betriebs, so wie sie dort gelten (`custom` = vom Betrieb angepasst) */
export async function listStandardRoles(hotelId: string) {
  const rows = await db().select().from(hotelRoleOverrides).where(eq(hotelRoleOverrides.hotelId, hotelId));
  return EDITABLE_STANDARD_ROLES.map((key) => {
    const o = rows.find((r) => r.role === key);
    const d = defaultsOf(key);
    return { key, defaultName: d.name, name: o?.name ?? d.name, areas: o ? o.areas.filter((a) => AREA_KEYS.has(a)) : d.areas, custom: !!o };
  });
}

/** Name und Seiten einer Standardrolle für diesen Betrieb ändern; wirkt sofort für alle Personen mit dieser Rolle */
export async function saveStandardRole(hotelId: string, key: string, input: { name: string; areas: string[] }, actor: string) {
  if (!(EDITABLE_STANDARD_ROLES as readonly string[]).includes(key)) throw new TeamError("Diese Rolle ist fest.");
  const k = key as LimitedRole;
  const v = roleSchema.parse(input);
  if (!v.areas.length) throw new TeamError("Mindestens eine Seite auswählen.");
  const lower = v.name.toLowerCase();
  const taken = (await listStandardRoles(hotelId)).filter((r) => r.key !== k).map((r) => r.name.toLowerCase());
  const fixed = (["owner", "manager", "staff"] as FullRole[]).map((r) => ROLE_LABEL[r].toLowerCase());
  if (fixed.includes(lower) || taken.includes(lower) || (await listRoles(hotelId)).some((r) => r.name.toLowerCase() === lower)) throw new TeamError("Eine Rolle mit diesem Namen gibt es schon.");
  const d = defaultsOf(k);
  const same = v.areas.length === d.areas.length && v.areas.every((a) => d.areas.includes(a));
  if (v.name === d.name && same) return resetStandardRole(hotelId, k, actor); // unverändert = Vorgabe
  await db()
    .insert(hotelRoleOverrides)
    .values({ hotelId, role: k, name: v.name === d.name ? null : v.name, areas: v.areas })
    .onConflictDoUpdate({ target: [hotelRoleOverrides.hotelId, hotelRoleOverrides.role], set: { name: v.name === d.name ? null : v.name, areas: v.areas, updatedAt: new Date() } });
  await audit(db(), { hotelId, actor, action: "role.standard.update", entity: "role", entityId: k, details: v });
}

/** Zurück auf die Vorgabe (Name und Seiten) */
export async function resetStandardRole(hotelId: string, key: string, actor: string) {
  if (!(EDITABLE_STANDARD_ROLES as readonly string[]).includes(key)) throw new TeamError("Diese Rolle ist fest.");
  await db().delete(hotelRoleOverrides).where(and(eq(hotelRoleOverrides.hotelId, hotelId), eq(hotelRoleOverrides.role, key)));
  await audit(db(), { hotelId, actor, action: "role.standard.reset", entity: "role", entityId: key });
}

export async function saveRole(hotelId: string, roleId: string | null, input: { name: string; areas: string[] }, actor: string) {
  const v = roleSchema.parse(input);
  if (!v.areas.length) throw new TeamError("Mindestens eine Seite auswählen.");
  const reserved = [...STANDARD_ROLES.map((k) => ROLE_LABEL[k]), ...(await listStandardRoles(hotelId)).map((r) => r.name)].map((n) => n.toLowerCase());
  if (reserved.includes(v.name.toLowerCase())) throw new TeamError("Dieser Name ist für eine Standardrolle reserviert.");
  const clash = (await listRoles(hotelId)).find((r) => r.name.toLowerCase() === v.name.toLowerCase() && r.id !== roleId);
  if (clash) throw new TeamError("Eine Rolle mit diesem Namen gibt es schon.");
  if (roleId) {
    const [r] = await db().update(hotelRoles).set(v).where(and(eq(hotelRoles.id, roleId), eq(hotelRoles.hotelId, hotelId))).returning();
    if (!r) throw new TeamError("Rolle nicht gefunden.");
    await audit(db(), { hotelId, actor, action: "role.update", entity: "role", entityId: r.id, details: v });
    return r;
  }
  const [r] = await db().insert(hotelRoles).values({ hotelId, ...v }).returning();
  await audit(db(), { hotelId, actor, action: "role.create", entity: "role", entityId: r.id, details: v });
  return r;
}

export async function deleteRole(hotelId: string, roleId: string, actor: string) {
  const [used] = await db().select({ n: sql<number>`count(*)::int` }).from(hotelMembers).where(and(eq(hotelMembers.hotelId, hotelId), eq(hotelMembers.role, `custom:${roleId}`)));
  if (used.n > 0) throw new TeamError(`Die Rolle ist noch ${used.n} Person(en) zugewiesen. Bitte zuerst deren Rolle ändern.`);
  const gone = await db().delete(hotelRoles).where(and(eq(hotelRoles.id, roleId), eq(hotelRoles.hotelId, hotelId))).returning();
  if (!gone.length) throw new TeamError("Rolle nicht gefunden.");
  await audit(db(), { hotelId, actor, action: "role.delete", entity: "role", entityId: roleId });
}

/** `role`: Standardrolle oder `custom:<id>` einer eigenen Rolle dieses Betriebs */
export async function setMemberRole(hotelId: string, email: string, role: string, actor: string) {
  const isStandard = (STANDARD_ROLES as string[]).includes(role);
  if (!isStandard) {
    const id = role.startsWith("custom:") ? role.slice(7) : "";
    const ok = id && (await db().select({ id: hotelRoles.id }).from(hotelRoles).where(and(eq(hotelRoles.id, id), eq(hotelRoles.hotelId, hotelId)))).length;
    if (!ok) throw new TeamError("Unbekannte Rolle.");
  }
  const e = z.string().trim().email("Ungültige E-Mail-Adresse").parse(email).toLowerCase();
  const [u] = await db().insert(users).values({ email: e }).onConflictDoUpdate({ target: users.email, set: { email: e } }).returning();
  await db().insert(hotelMembers).values({ hotelId, userId: u.id, role }).onConflictDoUpdate({ target: [hotelMembers.hotelId, hotelMembers.userId], set: { role } });
  await audit(db(), { hotelId, actor, action: "member.add", entity: "user", entityId: u.id, details: { email: e, role } });
}

export async function changeMemberRole(hotelId: string, userId: string, role: string, actor: string) {
  const [m] = await db().select({ email: users.email }).from(hotelMembers).innerJoin(users, eq(users.id, hotelMembers.userId)).where(and(eq(hotelMembers.hotelId, hotelId), eq(hotelMembers.userId, userId)));
  if (!m) throw new TeamError("Person nicht im Team.");
  await setMemberRole(hotelId, m.email, role, actor);
}
