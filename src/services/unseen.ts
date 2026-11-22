import { sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import type { Hotel } from "../db/schema";
import { SEEN_KINDS, type SeenKind, type TaskKind } from "../domain/unseen";
import { listOpenInvoices } from "./debtors";
import { inboxSplit } from "./inbox-split";

/**
 * Ungesehenes je Person (SPEC 20.1): Einträge, die nach dem letzten Öffnen der Liste durch diese Person eingegangen sind.
 * ASSUMPTION: Ohne Eintrag (neue Person, neue Art) gilt «jetzt» als zuletzt gesehen: keine Altlast als Zahl.
 */
export async function markSeen(userId: string, hotelId: string, kind: SeenKind): Promise<void> {
  await db().execute(sql`INSERT INTO user_seen (user_id, hotel_id, kind, seen_at) VALUES (${userId}, ${hotelId}, ${kind}, now())
    ON CONFLICT (user_id, hotel_id, kind) DO UPDATE SET seen_at = now()`);
}

/** zählt nur die verlangten Arten; legt fehlende Einträge mit «jetzt» an */
export async function unseenCounts(userId: string, hotelId: string, kinds: SeenKind[]): Promise<Partial<Record<SeenKind, number>>> {
  const out: Partial<Record<SeenKind, number>> = {};
  if (kinds.length === 0) return out;
  for (const k of kinds) {
    await db().execute(sql`INSERT INTO user_seen (user_id, hotel_id, kind) VALUES (${userId}, ${hotelId}, ${k}) ON CONFLICT DO NOTHING`);
  }
  const since = (k: SeenKind) => sql`(SELECT seen_at FROM user_seen WHERE user_id = ${userId} AND hotel_id = ${hotelId} AND kind = ${k})`;
  const split = await inboxSplit(hotelId);
  const queries: Record<SeenKind, () => Promise<number>> = {
    dininginbox: async () => rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM inquiries WHERE hotel_id = ${hotelId} AND kind = 'table' AND status = 'new' AND created_at > ${since("dininginbox")}`))[0]?.n ?? 0,
    inbox: async () => {
      const [a] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM inquiries WHERE hotel_id = ${hotelId} AND status = 'new' AND (${!split}::boolean OR kind <> 'table') AND created_at > ${since("inbox")}`));
      const [b] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM guest_requests WHERE hotel_id = ${hotelId} AND status = 'open' AND created_at > ${since("inbox")}`));
      return (a?.n ?? 0) + (b?.n ?? 0);
    },
    bookings: async () => rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM bookings WHERE hotel_id = ${hotelId} AND source = 'direct' AND status = 'confirmed' AND created_at > ${since("bookings")}`))[0]?.n ?? 0,
    reservations: async () => rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM pos_reservations WHERE hotel_id = ${hotelId} AND source = 'online' AND status IN ('confirmed','pending') AND created_at > ${since("reservations")}`))[0]?.n ?? 0,
    orders: async () => rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM online_orders WHERE hotel_id = ${hotelId} AND status NOT IN ('pending_payment','expired') AND created_at > ${since("orders")}`))[0]?.n ?? 0,
  };
  for (const k of kinds) out[k] = await queries[k]();
  return out;
}

export const SEEN_KIND_LIST = Object.keys(SEEN_KINDS) as SeenKind[];

/**
 * Offene Aufgaben je Betrieb (SPEC 20.1): gemeinsame Zahl, unabhängig vom Ansehen. Zählt nur die verlangten Arten.
 * ASSUMPTION: «Überfällig» = ausgestellte, nicht beglichene Rechnung nach Fälligkeit (wie die Liste der Debitoren).
 */
export async function openTaskCounts(hotel: Hotel, kinds: TaskKind[]): Promise<Partial<Record<TaskKind, number>>> {
  const out: Partial<Record<TaskKind, number>> = {};
  const split = kinds.includes("inbox") ? await inboxSplit(hotel.id) : false;
  for (const k of kinds) {
    if (k === "dininginbox") {
      out.dininginbox = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM inquiries WHERE hotel_id = ${hotel.id} AND kind = 'table' AND status = 'new'`))[0]?.n ?? 0;
    } else if (k === "inbox") {
      const [a] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM inquiries WHERE hotel_id = ${hotel.id} AND status = 'new' AND (${!split}::boolean OR kind <> 'table')`));
      const [b] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM guest_requests WHERE hotel_id = ${hotel.id} AND status = 'open'`));
      out.inbox = (a?.n ?? 0) + (b?.n ?? 0);
    } else if (k === "orders") {
      const [a] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM online_orders WHERE hotel_id = ${hotel.id} AND status = 'new'`));
      out.orders = a?.n ?? 0;
    } else if (k === "overdue") {
      out.overdue = (await listOpenInvoices(hotel)).filter((i) => i.daysOverdue > 0).length;
    }
  }
  return out;
}
