import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { bookings, guestProfiles, guests, type GuestProfile } from "../db/schema";
import { audit } from "./audit";

/** Gäste-Notizen und Tags (SPEC 17.2): pro Betrieb und E-Mail-Adresse, nie über Betriebe hinweg. */
export class GuestNoteError extends Error {}

export const MAX_TAGS = 8;
export const MAX_NOTE = 1000;
const norm = (e: string) => e.trim().toLowerCase();

/** Tags: getrimmt, ohne Leerzeichen-Mehrfach, max. 24 Zeichen, ohne Duplikate (Gross-/Kleinschreibung egal) */
export function cleanTags(raw: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(/[,;\n]/);
  const out: string[] = [];
  for (const t of list) {
    const v = t.replace(/\s+/g, " ").trim().slice(0, 24);
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out.slice(0, MAX_TAGS);
}

export async function profileOf(hotelId: string, email: string): Promise<GuestProfile | null> {
  const [p] = await db().select().from(guestProfiles).where(and(eq(guestProfiles.hotelId, hotelId), eq(guestProfiles.email, norm(email))));
  return p ?? null;
}

export async function saveProfile(hotelId: string, email: string, input: { note: string; tags: string | string[] }, actor: string): Promise<void> {
  const e = norm(email);
  if (!e) throw new GuestNoteError("Keine E-Mail-Adresse bekannt.");
  const note = input.note.trim();
  if (note.length > MAX_NOTE) throw new GuestNoteError(`Die Notiz ist zu lang (höchstens ${MAX_NOTE} Zeichen).`);
  const tags = cleanTags(input.tags);
  await db().transaction(async (tx) => {
    if (!note && !tags.length) {
      await tx.delete(guestProfiles).where(and(eq(guestProfiles.hotelId, hotelId), eq(guestProfiles.email, e)));
    } else {
      await tx.insert(guestProfiles).values({ hotelId, email: e, note, tags, updatedBy: actor })
        .onConflictDoUpdate({ target: [guestProfiles.hotelId, guestProfiles.email], set: { note, tags, updatedBy: actor, updatedAt: new Date() } });
    }
    // Inhalt der Notiz bewusst nicht im Protokoll (kann Personendaten enthalten)
    await audit(tx, { hotelId, actor, action: "guest.note", entity: "guest", entityId: e, details: { tags: tags.length, hasNote: !!note } });
  });
}

export type KarteiRow = { email: string; name: string; stays: number; lastCheckin: string | null; tags: string[]; note: string };

/** Kartei: alle Gäste mit Buchung oder Notiz; Suche über Name, E-Mail, Tag, Notiz */
export async function kartei(hotelId: string, q = "", tag = "", limit = 200): Promise<KarteiRow[]> {
  const rows = await db().select({
    email: sql<string>`lower(${guests.email})`, first: sql<string>`max(${guests.firstName})`, last: sql<string>`max(${guests.lastName})`,
    stays: sql<number>`count(${bookings.id}) filter (where ${bookings.status} = 'confirmed')::int`, lastCheckin: sql<string | null>`max(${bookings.checkin}) filter (where ${bookings.status} = 'confirmed')`,
  }).from(guests).leftJoin(bookings, eq(bookings.guestId, guests.id)).where(eq(guests.hotelId, hotelId)).groupBy(sql`lower(${guests.email})`);
  const profiles = await db().select().from(guestProfiles).where(eq(guestProfiles.hotelId, hotelId));
  const byEmail = new Map(profiles.map((p) => [p.email, p]));
  const out: KarteiRow[] = rows.map((r) => {
    const p = byEmail.get(r.email);
    return { email: r.email, name: [r.first, r.last].filter(Boolean).join(" "), stays: r.stays, lastCheckin: r.lastCheckin, tags: p?.tags ?? [], note: p?.note ?? "" };
  });
  const needle = q.trim().toLowerCase();
  const t = tag.trim().toLowerCase();
  return out
    .filter((r) => (!needle || [r.name, r.email, r.note, ...r.tags].some((x) => x.toLowerCase().includes(needle))) && (!t || r.tags.some((x) => x.toLowerCase() === t)))
    .sort((a, b) => (b.lastCheckin ?? "").localeCompare(a.lastCheckin ?? "") || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export async function allTags(hotelId: string): Promise<string[]> {
  const ps = await db().select({ tags: guestProfiles.tags }).from(guestProfiles).where(eq(guestProfiles.hotelId, hotelId));
  return [...new Set(ps.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b, "de"));
}
