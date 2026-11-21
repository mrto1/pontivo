import { z } from "zod";

/**
 * Offline-Kasse (SPEC 19.16): Vorgänge, die ein Gerät lokal sammelt und später überträgt. Alle Ids vergibt das Gerät (UUID),
 * damit eine Wiederholung nichts doppelt bucht. Reine Prüfung ohne I/O (auch im Browser nutzbar).
 */
const uuid = z.string().uuid();
const at = z.number().int().nonnegative(); // Gerätezeit in ms seit 1970

export const orderOp = z.object({ kind: z.literal("order"), id: uuid, tableId: uuid.nullable(), label: z.string().max(60), at });
export const linesOp = z.object({
  kind: z.literal("lines"), id: uuid, orderId: uuid, at,
  lines: z.array(z.object({
    id: uuid, itemId: uuid, quantity: z.number().int().min(1).max(99), mode: z.enum(["dine_in", "takeaway"]),
    description: z.string().min(1).max(120), unitPriceRappen: z.number().int().min(0).max(10_000_000), vatBps: z.number().int().min(0).max(2500),
    options: z.array(z.object({ group: z.string().max(60), name: z.string().max(60), priceRappen: z.number().int().min(0).max(1_000_000) })).max(30).optional(), note: z.string().max(120).optional(),
  })).min(1).max(50),
});
export const payOp = z.object({
  kind: z.literal("pay"), id: uuid, orderId: uuid, receiptId: uuid, bonNo: z.number().int().min(1), at,
  selection: z.array(z.object({ lineId: uuid, quantity: z.number().int().min(1).max(99) })).min(1).max(100),
  payments: z.array(z.object({ method: z.enum(["cash", "card", "twint", "room"]), amountRappen: z.number().int().min(1) })).min(1).max(4),
  tipRappen: z.number().int().min(0).max(1_000_000), bookingReference: z.string().max(20),
});
export const syncOp = z.discriminatedUnion("kind", [orderOp, linesOp, payOp]);
export type SyncOp = z.infer<typeof syncOp>;

export const bootstrapRequest = z.object({ hotelId: uuid, deviceKey: z.string().min(16).max(64), deviceCode: z.string().regex(/^[A-Z0-9]{1,6}$/).optional() });
export const syncRequest = z.object({ hotelId: uuid, deviceKey: z.string().min(16).max(64), deviceCode: z.string().regex(/^[A-Z0-9]{1,6}$/), pending: z.number().int().min(0).max(100000), ops: z.array(syncOp).max(100) });
export type SyncResult = { id: string; ok: boolean; error?: string };

/** Nächste Bon-Nummer des Geräts: höher als lokal vergeben und als der Server kennt */
export const nextBonNo = (localLast: number, serverLast: number) => Math.max(localLast, serverLast) + 1;
