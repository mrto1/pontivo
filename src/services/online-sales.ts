import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { onlineOrders, posDevices, posPayments, posReceipts, type Hotel } from "../db/schema";
import { salesByDay, type SaleDay } from "../domain/online-sales";

/**
 * Online-Verkäufe je Geschäftstag (SPEC 20.8): Bons des System-Geräts `ONL` (Online-Bestellungen), mit MWST je Satz,
 * Zahlart (online bezahlt / bar) und Plattformgebühr. Funktioniert ohne Modul `pos`.
 */
export async function onlineSalesDays(hotel: Pick<Hotel, "id">, from: string, to: string): Promise<SaleDay[]> {
  const [dev] = await db().select({ id: posDevices.id }).from(posDevices).where(and(eq(posDevices.hotelId, hotel.id), eq(posDevices.code, "ONL")));
  if (!dev) return [];
  const rec = await db().select().from(posReceipts).where(and(eq(posReceipts.hotelId, hotel.id), eq(posReceipts.deviceId, dev.id), sql`${posReceipts.businessDay} BETWEEN ${from}::date AND ${to}::date`));
  if (!rec.length) return [];
  const ids = rec.map((r) => r.id);
  const [pays, orders] = await Promise.all([
    db().select().from(posPayments).where(and(eq(posPayments.hotelId, hotel.id), inArray(posPayments.receiptId, ids))),
    db().select({ receiptId: onlineOrders.receiptId, fee: onlineOrders.feeRappen }).from(onlineOrders).where(and(eq(onlineOrders.hotelId, hotel.id), inArray(onlineOrders.receiptId, ids))),
  ]);
  const fee = new Map(orders.map((o) => [o.receiptId, o.fee]));
  const sign = (k: string) => (k === "reversal" ? -1 : 1);
  return salesByDay(rec.map((r) => ({
    day: r.businessDay, totalRappen: r.totalRappen, vat: r.vat, feeRappen: (fee.get(r.id) ?? 0) * sign(r.kind),
    payments: pays.filter((p) => p.receiptId === r.id).map((p) => ({ method: p.method, amountRappen: p.amountRappen })),
  })));
}
