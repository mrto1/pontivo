import { UserError } from "../domain/errors";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db/client";
import { bookingRooms, bookings, ownerCosts, ownerStatements, owners, roomTypes, type Hotel, type Owner } from "../db/schema";
import { enqueueEmail } from "../email/enqueue";
import { monthEnd } from "../domain/hesta";
import { monthRevenue, overlap, statement, validMonth, type Statement } from "../domain/owners";
import { audit } from "./audit";

/** Eigentümerabrechnung (SPEC 19.10). Jede Abfrage nach hotel_id. */
export class OwnerError extends UserError {}

export type OwnerInput = { name: string; email?: string; commissionPercent: number; roomTypeIds: string[]; note?: string; active?: boolean };

export const listOwners = (hotelId: string) => db().select().from(owners).where(eq(owners.hotelId, hotelId)).orderBy(asc(owners.name));

export async function saveOwner(hotelId: string, id: string | null, input: OwnerInput, actor: string): Promise<Owner> {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new OwnerError("Der Name fehlt.");
  const email = (input.email ?? "").trim().slice(0, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OwnerError("Die E-Mail-Adresse ist ungültig.");
  const bps = Math.round(input.commissionPercent * 100);
  if (!Number.isFinite(bps) || bps < 0 || bps > 10000) throw new OwnerError("Kommission: 0 bis 100 Prozent.");
  const ids = [...new Set(input.roomTypeIds)];
  if (ids.length) {
    const found = await db().select({ id: roomTypes.id }).from(roomTypes).where(and(eq(roomTypes.hotelId, hotelId), inArray(roomTypes.id, ids)));
    if (found.length !== ids.length) throw new OwnerError("Unbekanntes Objekt (Zimmertyp).");
  }
  const active = input.active ?? true;
  const others = await db().select({ ids: owners.roomTypeIds }).from(owners).where(and(eq(owners.hotelId, hotelId), eq(owners.active, true), id ? ne(owners.id, id) : sql`true`));
  if (active && overlap(ids, others.map((o) => o.ids)).length) throw new OwnerError("Ein Objekt gehört schon einem anderen Eigentümer.");
  const v = { name, email, commissionBps: bps, roomTypeIds: ids, note: (input.note ?? "").trim().slice(0, 500), active };
  return db().transaction(async (tx) => {
    let o: Owner;
    if (id) {
      [o] = await tx.update(owners).set(v).where(and(eq(owners.id, id), eq(owners.hotelId, hotelId))).returning();
      if (!o) throw new OwnerError("Eigentümer nicht gefunden.");
    } else {
      [o] = await tx.insert(owners).values({ ...v, hotelId }).returning();
    }
    await audit(tx, { hotelId, actor, action: id ? "owner.update" : "owner.create", entity: "owner", entityId: o.id });
    return o;
  });
}

export async function addCost(hotelId: string, ownerId: string, month: string, description: string, amountRappen: number, actor: string) {
  if (!validMonth(month)) throw new OwnerError("Monat ungültig (JJJJ-MM).");
  const d = description.trim().slice(0, 200);
  if (!d) throw new OwnerError("Bitte beschreiben, wofür die Kosten sind.");
  if (!Number.isInteger(amountRappen) || amountRappen <= 0) throw new OwnerError("Der Betrag muss grösser als 0 sein.");
  const [o] = await db().select({ id: owners.id }).from(owners).where(and(eq(owners.id, ownerId), eq(owners.hotelId, hotelId)));
  if (!o) throw new OwnerError("Eigentümer nicht gefunden.");
  await db().transaction(async (tx) => {
    const [c] = await tx.insert(ownerCosts).values({ hotelId, ownerId, month, description: d, amountRappen, createdBy: actor }).returning({ id: ownerCosts.id });
    await audit(tx, { hotelId, actor, action: "owner.cost_add", entity: "owner", entityId: ownerId, details: { month, amountRappen, costId: c.id } });
  });
}

export async function deleteCost(hotelId: string, costId: string, actor: string) {
  await db().transaction(async (tx) => {
    const [c] = await tx.delete(ownerCosts).where(and(eq(ownerCosts.id, costId), eq(ownerCosts.hotelId, hotelId))).returning();
    if (c) await audit(tx, { hotelId, actor, action: "owner.cost_delete", entity: "owner", entityId: c.ownerId, details: { month: c.month, amountRappen: c.amountRappen } });
  });
}

export type OwnerStatement = Statement & { owner: Owner; month: string; commissionBps: number; costs: { id: string; description: string; amountRappen: number }[]; bookingsCount: number; sentAt: Date | null };

/**
 * Abrechnung eines Monats: Übernachtungsumsatz bestätigter Buchungen für die Zimmertypen des Eigentümers (Nächte im Monat),
 * minus Kommission des Hauses, minus erfasste Kosten. Versendete Abrechnungen bleiben als Stand gespeichert (`owner_statements`).
 */
export async function ownerStatement(hotelId: string, ownerId: string, month: string): Promise<OwnerStatement> {
  if (!validMonth(month)) throw new OwnerError("Monat ungültig (JJJJ-MM).");
  const [owner] = await db().select().from(owners).where(and(eq(owners.id, ownerId), eq(owners.hotelId, hotelId)));
  if (!owner) throw new OwnerError("Eigentümer nicht gefunden.");
  const rows = owner.roomTypeIds.length
    ? await db().select({ bookingId: bookingRooms.bookingId, nights: bookingRooms.nightlyPrices }).from(bookingRooms).innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
        .where(and(eq(bookings.hotelId, hotelId), eq(bookings.status, "confirmed"), inArray(bookingRooms.roomTypeId, owner.roomTypeIds), sql`${bookings.checkin} < ${monthEnd(month)}`, sql`${bookings.checkout} > ${`${month}-01`}`))
    : [];
  let revenue = 0;
  const ids = new Set<string>();
  for (const r of rows) {
    const x = monthRevenue(r.nights.map((n) => ({ night: n.night, priceRappen: n.price_rappen })), month);
    if (x) { revenue += x; ids.add(r.bookingId); }
  }
  const costs = await db().select({ id: ownerCosts.id, description: ownerCosts.description, amountRappen: ownerCosts.amountRappen }).from(ownerCosts)
    .where(and(eq(ownerCosts.hotelId, hotelId), eq(ownerCosts.ownerId, ownerId), eq(ownerCosts.month, month))).orderBy(asc(ownerCosts.createdAt));
  const [sent] = await db().select({ sentAt: ownerStatements.sentAt }).from(ownerStatements).where(and(eq(ownerStatements.hotelId, hotelId), eq(ownerStatements.ownerId, ownerId), eq(ownerStatements.month, month)));
  const st = statement(revenue, owner.commissionBps, costs.reduce((a, c) => a + c.amountRappen, 0));
  return { ...st, owner, month, commissionBps: owner.commissionBps, costs, bookingsCount: ids.size, sentAt: sent?.sentAt ?? null };
}

/** Abrechnung per Mail an den Eigentümer (je Monat nur einmal; Stand wird gespeichert) */
export async function sendStatement(hotel: Hotel, ownerId: string, month: string, actor: string) {
  const s = await ownerStatement(hotel.id, ownerId, month);
  if (!s.owner.email) throw new OwnerError("Für diesen Eigentümer ist keine E-Mail-Adresse erfasst.");
  if (s.sentAt) throw new OwnerError("Diese Abrechnung wurde schon versendet.");
  await db().transaction(async (tx) => {
    const ins = await tx.insert(ownerStatements).values({ hotelId: hotel.id, ownerId, month, revenueRappen: s.revenueRappen, commissionRappen: s.commissionRappen, costsRappen: s.costsRappen, netRappen: s.netRappen, sentTo: s.owner.email }).onConflictDoNothing().returning({ id: ownerStatements.id });
    if (!ins.length) throw new OwnerError("Diese Abrechnung wurde schon versendet.");
    await enqueueEmail(tx, { hotelId: hotel.id, template: "owner_statement", to: s.owner.email, language: hotel.defaultLanguage ?? "de", data: { ownerName: s.owner.name, month, ownerId, revenueRappen: s.revenueRappen, commissionRappen: s.commissionRappen, costsRappen: s.costsRappen, netRappen: s.netRappen } });
    await audit(tx, { hotelId: hotel.id, actor, action: "owner.statement_sent", entity: "owner", entityId: ownerId, details: { month, netRappen: s.netRappen } });
  });
}
