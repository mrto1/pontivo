import { UserError } from "../domain/errors";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { hotelMembers, hotels, salesLeadEvents, salesLeads, users, type SalesLead } from "../db/schema";
import { enqueueEmail } from "../email/enqueue";
import { env } from "../env";
import { LEAD_SOURCES, LEAD_STATUSES, fillTemplate, funnelOf, isOpenStatus, templateById, type LeadSource, type LeadStatus } from "../domain/sales";
import { todayIn } from "../domain/dates";

/** Vertriebs-Cockpit der Plattform-Verwaltung (SPEC 19.31) */

export class SalesError extends UserError {}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+$/g, "").trim().slice(0, n);
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

async function event(leadId: string, kind: "created" | "status" | "mail" | "note", text: string, actor: string) {
  await db().insert(salesLeadEvents).values({ leadId, kind, text: text.slice(0, 2000), actor });
}

export type LeadInput = { name: string; contactName?: string; email?: string; phone?: string; website?: string; canton?: string; source?: string; notes?: string; nextActionAt?: string | null };

export async function createLead(input: LeadInput, actor: string): Promise<SalesLead> {
  const name = clip(input.name, 120);
  if (!name) throw new SalesError("Name des Betriebs fehlt");
  const email = clip(input.email, 200).toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw new SalesError("E-Mail-Adresse ungültig");
  const source = (LEAD_SOURCES as readonly string[]).includes(input.source ?? "") ? (input.source as LeadSource) : "manuell";
  const next = clip(input.nextActionAt, 10);
  if (next && !isDay(next)) throw new SalesError("Datum ungültig");
  const canton = clip(input.canton, 2).toUpperCase();
  const [lead] = await db().insert(salesLeads).values({
    name, contactName: clip(input.contactName, 120), email, phone: clip(input.phone, 40), website: clip(input.website, 200),
    canton: /^[A-Z]{2}$/.test(canton) ? canton : null, source, notes: clip(input.notes, 4000), nextActionAt: next || null,
  }).returning();
  await event(lead.id, "created", `Angelegt (${source})`, actor);
  return lead;
}

export async function setLeadStatus(id: string, status: string, actor: string): Promise<SalesLead> {
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) throw new SalesError("Status ungültig");
  const [old] = await db().select().from(salesLeads).where(eq(salesLeads.id, id));
  if (!old) throw new SalesError("Lead nicht gefunden");
  if (old.status === status) return old;
  // abgeschlossene Leads brauchen keinen nächsten Schritt mehr
  const [l] = await db().update(salesLeads).set({ status: status as LeadStatus, updatedAt: new Date(), ...(isOpenStatus(status as LeadStatus) ? {} : { nextActionAt: null }) }).where(eq(salesLeads.id, id)).returning();
  await event(id, "status", `${old.status} → ${status}`, actor);
  return l;
}

export async function updateLead(id: string, input: { notes?: string; nextActionAt?: string | null; doNotContact?: boolean; contactName?: string; email?: string; phone?: string }, actor: string): Promise<SalesLead> {
  const [old] = await db().select().from(salesLeads).where(eq(salesLeads.id, id));
  if (!old) throw new SalesError("Lead nicht gefunden");
  const set: Partial<typeof salesLeads.$inferInsert> = { updatedAt: new Date() };
  if (input.notes !== undefined) set.notes = clip(input.notes, 4000);
  if (input.nextActionAt !== undefined) {
    const n = clip(input.nextActionAt, 10);
    if (n && !isDay(n)) throw new SalesError("Datum ungültig");
    set.nextActionAt = n || null;
  }
  if (input.doNotContact !== undefined) set.doNotContact = input.doNotContact;
  if (input.contactName !== undefined) set.contactName = clip(input.contactName, 120);
  if (input.phone !== undefined) set.phone = clip(input.phone, 40);
  if (input.email !== undefined) {
    const e = clip(input.email, 200).toLowerCase();
    if (e && !EMAIL_RE.test(e)) throw new SalesError("E-Mail-Adresse ungültig");
    set.email = e;
  }
  const [l] = await db().update(salesLeads).set(set).where(eq(salesLeads.id, id)).returning();
  if (input.doNotContact !== undefined && input.doNotContact !== old.doNotContact) await event(id, "note", input.doNotContact ? "Nicht mehr kontaktieren" : "Kontakt wieder erlaubt", actor);
  if (input.notes !== undefined && clip(input.notes, 4000) !== old.notes) await event(id, "note", "Notiz geändert", actor);
  return l;
}

/**
 * Persönliche Mail an einen Interessenten aus einer Vorlage, optional mit eigener Zeile vorn. Kein Massenversand: je Aufruf ein Lead.
 * Nicht möglich ohne Adresse oder bei «nicht mehr kontaktieren».
 */
export async function sendLeadMail(id: string, templateId: string, o: { extraLine?: string; senderName: string }, actor: string): Promise<void> {
  const [lead] = await db().select().from(salesLeads).where(eq(salesLeads.id, id));
  if (!lead) throw new SalesError("Lead nicht gefunden");
  const tpl = templateById(templateId);
  if (!tpl) throw new SalesError("Vorlage unbekannt");
  if (!lead.email) throw new SalesError("Keine E-Mail-Adresse hinterlegt");
  if (lead.doNotContact) throw new SalesError("Diese Person möchte nicht mehr kontaktiert werden");
  const vars = { kontakt: lead.contactName, betrieb: lead.name, absender: o.senderName, plattform: env().PLATFORM_NAME };
  const extra = clip(o.extraLine, 600);
  const body = (extra ? `${extra}\n\n` : "") + fillTemplate(tpl.body, vars);
  const subject = fillTemplate(tpl.subject, vars);
  await db().transaction(async (tx) => {
    await enqueueEmail(tx, { hotelId: null, template: "sales_lead", to: lead.email, language: "de", data: { subject, body } });
    await tx.update(salesLeads).set({ lastMailAt: new Date(), updatedAt: new Date(), ...(lead.status === "neu" && tpl.moves ? { status: tpl.moves } : {}) }).where(eq(salesLeads.id, id));
    await tx.insert(salesLeadEvents).values({ leadId: id, kind: "mail", text: `Mail «${tpl.label}» an ${lead.email}`, actor });
    if (lead.status === "neu" && tpl.moves) await tx.insert(salesLeadEvents).values({ leadId: id, kind: "status", text: `neu → ${tpl.moves}`, actor });
  });
}

/**
 * Leads und Betriebe abgleichen (idempotent, beim Öffnen des Cockpits): Jeder Betrieb ohne Lead bekommt einen («Selbst registriert»,
 * Kontakt = Inhaber); ein Lead mit online geschaltetem Betrieb gilt als gewonnen.
 */
export async function syncLeads(): Promise<{ created: number; won: number }> {
  const missing = await db().select({ id: hotels.id, name: hotels.name, canton: hotels.canton, email: hotels.contactEmail, status: hotels.status, createdAt: hotels.createdAt })
    .from(hotels).leftJoin(salesLeads, eq(salesLeads.hotelId, hotels.id)).where(isNull(salesLeads.id));
  let created = 0;
  for (const h of missing) {
    const [owner] = await db().select({ name: users.name, email: users.email }).from(hotelMembers).innerJoin(users, eq(users.id, hotelMembers.userId))
      .where(and(eq(hotelMembers.hotelId, h.id), eq(hotelMembers.role, "owner"))).limit(1);
    // zugleich per E-Mail-Adresse zusammenführen: ein von Hand angelegter Lead wird mit dem Betrieb verknüpft
    const email = (owner?.email ?? h.email ?? "").toLowerCase();
    const [existing] = email ? await db().select().from(salesLeads).where(and(eq(salesLeads.email, email), isNull(salesLeads.hotelId))).limit(1) : [];
    if (existing) {
      await db().update(salesLeads).set({ hotelId: h.id, updatedAt: new Date() }).where(eq(salesLeads.id, existing.id));
      await event(existing.id, "note", `Mit Betrieb «${h.name}» verknüpft`, "system");
      continue;
    }
    const ins = await db().insert(salesLeads).values({
      name: h.name, contactName: owner?.name ?? "", email, canton: h.canton, source: "registrierung", hotelId: h.id,
      status: h.status === "live" ? "gewonnen" : "neu", createdAt: h.createdAt,
    }).onConflictDoNothing().returning({ id: salesLeads.id });
    if (ins[0]) { await event(ins[0].id, "created", "Selbst registriert", "system"); created++; }
  }
  const won = await db().update(salesLeads).set({ status: "gewonnen", nextActionAt: null, updatedAt: new Date() })
    .where(and(inArray(salesLeads.status, ["neu", "kontaktiert", "demo", "angebot"]), sql`${salesLeads.hotelId} IN (SELECT id FROM hotels WHERE status = 'live')`)).returning({ id: salesLeads.id });
  for (const w of won) await event(w.id, "status", "Betrieb ist online → gewonnen", "system");
  return { created, won: won.length };
}

export async function listLeads(opts: { status?: string } = {}) {
  const where = opts.status && (LEAD_STATUSES as readonly string[]).includes(opts.status) ? eq(salesLeads.status, opts.status as LeadStatus) : undefined;
  return db().select().from(salesLeads).where(where).orderBy(sql`${salesLeads.nextActionAt} ASC NULLS LAST`, desc(salesLeads.createdAt));
}

export async function cockpit(now = new Date()) {
  const all = await db().select().from(salesLeads);
  const today = todayIn("Europe/Zurich", now);
  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  return {
    funnel: funnelOf(all.map((l) => l.status)),
    newThisWeek: all.filter((l) => l.createdAt >= weekAgo).length,
    due: all.filter((l) => isOpenStatus(l.status) && l.nextActionAt && l.nextActionAt <= today).length,
    today,
  };
}

export const leadEvents = (leadId: string, limit = 20) =>
  db().select().from(salesLeadEvents).where(eq(salesLeadEvents.leadId, leadId)).orderBy(desc(salesLeadEvents.createdAt), desc(salesLeadEvents.id)).limit(limit);
