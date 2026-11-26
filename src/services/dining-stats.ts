import { and, between, eq, gte, lt } from "drizzle-orm";
import { db } from "../db/client";
import { posOrders, posReceipts, posReservations, posTables, posWaiters, tableFeedback } from "../db/schema";
import { aggregate, type DiningStats } from "../domain/dining-stats";
import { addDays } from "../domain/dates";

/** Auswertung Restaurant für einen Zeitraum (Geschäftstage von bis, einschliesslich). Jede Abfrage nach hotel_id. */
export async function diningStats(hotelId: string, from: string, to: string): Promise<DiningStats> {
  const receipts = await db().select({ orderId: posReceipts.orderId, totalRappen: posReceipts.totalRappen, tipRappen: posReceipts.tipRappen, paidAt: posReceipts.paidAt })
    .from(posReceipts).where(and(eq(posReceipts.hotelId, hotelId), between(posReceipts.businessDay, from, to)));
  const [orders, tables, waiters, reservations, feedback] = await Promise.all([
    db().select({ id: posOrders.id, tableId: posOrders.tableId, openedAt: posOrders.openedAt }).from(posOrders).where(eq(posOrders.hotelId, hotelId)),
    db().select({ id: posTables.id, name: posTables.name, waiterId: posTables.waiterId }).from(posTables).where(eq(posTables.hotelId, hotelId)),
    db().select({ id: posWaiters.id, name: posWaiters.name }).from(posWaiters).where(eq(posWaiters.hotelId, hotelId)),
    db().select({ time: posReservations.time, party: posReservations.party, status: posReservations.status }).from(posReservations).where(and(eq(posReservations.hotelId, hotelId), between(posReservations.day, from, to))),
    db().select({ stars: tableFeedback.stars, comment: tableFeedback.comment }).from(tableFeedback).where(and(eq(tableFeedback.hotelId, hotelId), gte(tableFeedback.createdAt, new Date(`${from}T00:00:00Z`)), lt(tableFeedback.createdAt, new Date(`${addDays(to, 1)}T00:00:00Z`)))),
  ]);
  return aggregate({ receipts, orders, tables, waiters, reservations, feedback });
}
