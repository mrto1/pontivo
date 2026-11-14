import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { rows } from "../db/client";
import { addDays, nightsOf } from "../domain/dates";
import { enqueueAvailability } from "./outbox";

/**
 * Zimmerblock einer Gruppe (SPEC 18.1). Reservierte Zimmer sind in `inventory_days.booked` mitgezählt und in
 * `group_block_days.rooms` pro Nacht als «noch nicht vergeben» geführt. Verfügbarkeit, Channex und iCal ändern sich dadurch nicht.
 */
export class BlockError extends Error {
  constructor(public code: "sold_out" | "block_exhausted" | "not_enough" | "bad_range", msg: string) { super(msg); }
}

/** Block um `delta` Zimmer pro Nacht erhöhen (prüft die Verfügbarkeit) oder verringern (nur freie Blockzimmer) */
export async function adjustBlock(tx: Tx, hotelId: string, groupId: string, roomTypeId: string, from: string, toExclusive: string, delta: number): Promise<void> {
  const nights = nightsOf(from, toExclusive);
  if (!nights.length || !Number.isInteger(delta) || delta === 0) throw new BlockError("bad_range", "Zeitraum oder Anzahl ungültig.");
  if (delta > 0) {
    const inv = await tx.execute(sql`
      UPDATE inventory_days SET booked = booked + ${delta}, updated_at = now()
       WHERE hotel_id = ${hotelId} AND room_type_id = ${roomTypeId} AND night >= ${from}::date AND night < ${toExclusive}::date
         AND total - booked - blocked - external_blocked >= ${delta}
      RETURNING night`);
    if (inv.rows.length !== nights.length) throw new BlockError("sold_out", "So viele Zimmer sind in diesem Zeitraum nicht mehr frei.");
    await tx.execute(sql`
      INSERT INTO group_block_days (group_id, room_type_id, night, rooms)
      SELECT ${groupId}, ${roomTypeId}, d::date, ${delta} FROM generate_series(${from}::date, ${toExclusive}::date - 1, interval '1 day') d
      ON CONFLICT (group_id, room_type_id, night) DO UPDATE SET rooms = group_block_days.rooms + ${delta}`);
  } else {
    const n = -delta;
    const g = await tx.execute(sql`
      UPDATE group_block_days SET rooms = rooms - ${n}
       WHERE group_id = ${groupId} AND room_type_id = ${roomTypeId} AND night >= ${from}::date AND night < ${toExclusive}::date AND rooms >= ${n}
      RETURNING night`);
    if (g.rows.length !== nights.length) throw new BlockError("not_enough", "So viele freie Blockzimmer gibt es nicht (der Rest ist schon vergeben).");
    await tx.execute(sql`
      UPDATE inventory_days SET booked = booked - ${n}, updated_at = now()
       WHERE hotel_id = ${hotelId} AND room_type_id = ${roomTypeId} AND night >= ${from}::date AND night < ${toExclusive}::date`);
  }
  await enqueueAvailability(tx, hotelId, roomTypeId, from, addDays(toExclusive, -1));
}

/**
 * Ein Zimmer aus dem Block an eine Buchung vergeben: pro Nacht ein freies Blockzimmer und ein gebuchtes Zimmer zurück an den Bestand,
 * sodass die normale Reservierung danach dieselben Zimmer wieder belegt (alles in derselben Transaktion).
 */
export async function consumeBlock(tx: Tx, hotelId: string, groupId: string, roomTypeId: string, checkin: string, checkout: string): Promise<void> {
  const nights = nightsOf(checkin, checkout);
  const g = await tx.execute(sql`
    UPDATE group_block_days SET rooms = rooms - 1
     WHERE group_id = ${groupId} AND room_type_id = ${roomTypeId} AND night >= ${checkin}::date AND night < ${checkout}::date AND rooms >= 1
    RETURNING night`);
  if (g.rows.length !== nights.length) throw new BlockError("block_exhausted", "Im Zimmerblock ist für diese Nächte nichts mehr frei.");
  await tx.execute(sql`
    UPDATE inventory_days SET booked = booked - 1, updated_at = now()
     WHERE hotel_id = ${hotelId} AND room_type_id = ${roomTypeId} AND night >= ${checkin}::date AND night < ${checkout}::date`);
}

/** Alle noch freien Blockzimmer der Gruppe zurück in den Verkauf */
export async function releaseAll(tx: Tx, hotelId: string, groupId: string): Promise<number> {
  const left = rows<{ room_type_id: string; night: string; rooms: number }>(await tx.execute(sql`
    SELECT room_type_id, night::text AS night, rooms FROM group_block_days WHERE group_id = ${groupId} AND rooms > 0`));
  let total = 0;
  const byType = new Map<string, string[]>();
  for (const r of left) {
    await tx.execute(sql`UPDATE inventory_days SET booked = booked - ${r.rooms}, updated_at = now() WHERE hotel_id = ${hotelId} AND room_type_id = ${r.room_type_id} AND night = ${r.night}::date`);
    total += r.rooms;
    byType.set(r.room_type_id, [...(byType.get(r.room_type_id) ?? []), r.night]);
  }
  await tx.execute(sql`UPDATE group_block_days SET rooms = 0 WHERE group_id = ${groupId}`);
  for (const [rt, ns] of byType) {
    ns.sort();
    await enqueueAvailability(tx, hotelId, rt, ns[0], ns[ns.length - 1]);
  }
  return total;
}
