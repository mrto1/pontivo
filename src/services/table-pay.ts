import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { posDevices, posOrders, posTables, restaurantSettings, tableFeedback, tablePayments, hotels, type Hotel, type PosTable, type TablePayment } from "../db/schema";
import { checkSelection, openTotalRappen, outstanding, selectionTotal, type Selection } from "../domain/pos";
import { isLocale } from "../i18n/dict";
import { getPaymentProvider } from "../payments/provider";
import { audit } from "./audit";
import { PosError, createDevice, orderState, pay } from "./pos";
import { publicUrl } from "./online-orders";

/**
 * Zahlung am Tisch per QR-Code (SPEC 19.55): Der Gast sieht die offenen Posten seines Tisches, wählt aus, gibt Trinkgeld und zahlt über Stripe.
 * Nach der Zahlung (Webhook) entsteht der Bon in der Kasse (Gerät «QR»). Trinkgeld wird dem Kellner des Tisches zugeordnet.
 */
export const TIP_MAX_RAPPEN = 1_000_000;
const token = () => randomBytes(18).toString("base64url");

/** QR-Token des Tisches (wird bei Bedarf angelegt). */
export async function ensureQrToken(hotelId: string, tableId: string): Promise<string> {
  const [t] = await db().select().from(posTables).where(and(eq(posTables.id, tableId), eq(posTables.hotelId, hotelId)));
  if (!t) throw new PosError("Tisch nicht gefunden.");
  if (t.qrToken) return t.qrToken;
  const q = randomBytes(12).toString("hex");
  const [u] = await db().update(posTables).set({ qrToken: q }).where(and(eq(posTables.id, tableId), eq(posTables.hotelId, hotelId))).returning();
  return u.qrToken!;
}

export async function tableByQr(qr: string): Promise<{ hotel: Hotel; table: PosTable } | null> {
  if (!/^[0-9a-f]{24}$/.test(qr)) return null;
  const [t] = await db().select().from(posTables).where(eq(posTables.qrToken, qr));
  if (!t || !t.active) return null;
  const [h] = await db().select().from(hotels).where(eq(hotels.id, t.hotelId));
  return h ? { hotel: h, table: t } : null;
}

export type BillLine = { orderId: string; lineId: string; description: string; unitPriceRappen: number; openQty: number };

/** Offene Posten des Tisches (alle offenen Bestellungen), nur Zeilen mit offener Menge. */
export async function tableBill(hotelId: string, tableId: string): Promise<{ lines: BillLine[]; totalRappen: number }> {
  const orders = await db().select().from(posOrders).where(and(eq(posOrders.hotelId, hotelId), eq(posOrders.tableId, tableId)));
  const lines: BillLine[] = [];
  let total = 0;
  for (const o of orders) {
    const st = await orderState(db(), hotelId, o.id);
    const open = outstanding(st.lines, st.paid);
    for (const l of st.rows) {
      const q = open.get(l.id) ?? 0;
      if (q > 0 && !l.reversesLineId) lines.push({ orderId: o.id, lineId: l.id, description: l.description, unitPriceRappen: l.unitPriceRappen, openQty: q });
    }
    total += Math.max(0, openTotalRappen(st.lines, st.paid));
  }
  return { lines, totalRappen: total };
}

export type StartInput = { orderId: string; selection: Selection[]; tipRappen: number; language?: string; email?: string };

/** Zahlung starten: prüft die Auswahl, legt den Vorgang an und liefert die Stripe-Adresse. */
export async function startTablePayment(hotel: Hotel, table: PosTable, i: StartInput): Promise<{ payment: TablePayment; url: string | null }> {
  const tip = i.tipRappen;
  if (!Number.isInteger(tip) || tip < 0 || tip > TIP_MAX_RAPPEN) throw new PosError("Trinkgeld ungültig.");
  const [order] = await db().select().from(posOrders).where(and(eq(posOrders.id, i.orderId), eq(posOrders.hotelId, hotel.id), eq(posOrders.tableId, table.id)));
  if (!order) throw new PosError("Bestellung nicht gefunden.");
  const st = await orderState(db(), hotel.id, order.id);
  const bad = checkSelection(st.lines, st.paid, i.selection);
  if (bad) throw new PosError(bad);
  const items = selectionTotal(st.lines, i.selection).totalRappen;
  if (items <= 0) throw new PosError("Der Betrag muss grösser als 0 sein.");
  if (!hotel.stripeAccountId || !hotel.stripeChargesEnabled) throw new PosError("Online-Zahlung ist zurzeit nicht möglich.");
  const lang = i.language && isLocale(i.language) ? i.language : "de";
  const pt = token();
  const [p] = await db().insert(tablePayments).values({ hotelId: hotel.id, tableId: table.id, orderId: order.id, publicToken: pt, selection: i.selection, itemsRappen: items, tipRappen: tip, waiterId: table.waiterId, language: lang }).returning();
  await audit(db(), { hotelId: hotel.id, actor: "guest", action: "tablepay.start", entity: "table_payment", entityId: p.id, details: { items, tip, table: table.name } });
  try {
    const provider = await getPaymentProvider();
    const back = `${publicUrl(hotel)}/${lang}/am-tisch/${table.qrToken}?z=${pt}`;
    // ASSUMPTION: keine Plattformgebühr auf Zahlungen am Tisch (Verkauf vor Ort, SPEC 19.55)
    const co = await provider.createPaymentCheckout({
      hotel, amountRappen: items + tip, feeRappen: 0, email: (i.email ?? "").trim(), lang: lang as "de" | "en" | "fr" | "it" | "nl",
      description: `${hotel.name} – ${table.name}${tip ? " (inkl. Trinkgeld)" : ""}`.slice(0, 250), successUrl: back, cancelUrl: `${publicUrl(hotel)}/${lang}/am-tisch/${table.qrToken}?abgebrochen=1`,
      metadata: { table_payment_id: p.id }, reference: p.id.slice(0, 8), idempotencyKey: `table-pay-${p.id}`,
    });
    await db().update(tablePayments).set({ stripeSessionId: co.sessionId }).where(eq(tablePayments.id, p.id));
    if (provider.confirmsImmediately) {
      await markTablePaid(p.id, { sessionId: co.sessionId, paymentIntentId: provider.name === "fake" ? `fake_pi_${p.id}` : null });
      return { payment: (await paymentByToken(pt))!, url: null };
    }
    return { payment: p, url: co.url };
  } catch (e) {
    await db().update(tablePayments).set({ status: "failed" }).where(eq(tablePayments.id, p.id));
    console.error("[table-pay checkout]", e);
    throw new PosError("Die Zahlung konnte nicht gestartet werden. Bitte versuchen Sie es erneut.");
  }
}

export async function paymentByToken(t: string): Promise<TablePayment | null> {
  const [p] = await db().select().from(tablePayments).where(eq(tablePayments.publicToken, t));
  return p ?? null;
}

async function tableDevice(hotelId: string) {
  const [d] = await db().select().from(posDevices).where(and(eq(posDevices.hotelId, hotelId), eq(posDevices.code, "QR")));
  return d ?? createDevice(hotelId, "QR", "Tisch-QR", "system");
}

/**
 * Zahlung eingegangen (Webhook): Bon in der Kasse buchen. Ist inzwischen etwas am Tisch anders bezahlt worden und der Bon nicht mehr möglich,
 * wird die Zahlung zurückerstattet. Wiederholung ist unschädlich.
 */
export async function markTablePaid(id: string, p: { sessionId: string | null; paymentIntentId: string | null }): Promise<"paid" | "refunded" | "already"> {
  const [claimed] = await db().update(tablePayments).set({ status: "paid", paidAt: new Date(), stripeSessionId: p.sessionId, stripePaymentIntentId: p.paymentIntentId })
    .where(and(eq(tablePayments.id, id), eq(tablePayments.status, "pending"))).returning();
  if (!claimed) return "already";
  const [h] = await db().select().from(hotels).where(eq(hotels.id, claimed.hotelId));
  try {
    const dev = await tableDevice(claimed.hotelId);
    const r = await pay(h, { orderId: claimed.orderId, deviceId: dev.id, selection: claimed.selection, payments: [{ method: "card", amountRappen: claimed.itemsRappen }], tipRappen: claimed.tipRappen }, "Tisch-QR");
    await db().update(tablePayments).set({ receiptId: r.id }).where(eq(tablePayments.id, id));
    await audit(db(), { hotelId: claimed.hotelId, actor: "stripe", action: "tablepay.paid", entity: "table_payment", entityId: id, details: { items: claimed.itemsRappen, tip: claimed.tipRappen, waiterId: claimed.waiterId } });
    return "paid";
  } catch (e) {
    if (!(e instanceof PosError)) throw e;
    await db().update(tablePayments).set({ status: "failed" }).where(eq(tablePayments.id, id));
    const provider = await getPaymentProvider();
    await provider.refund({ hotel: h, booking: { id: claimed.id }, paymentIntentId: p.paymentIntentId, amountRappen: claimed.itemsRappen + claimed.tipRappen });
    await audit(db(), { hotelId: claimed.hotelId, actor: "stripe", action: "tablepay.refunded", entity: "table_payment", entityId: id, details: { reason: e.message } });
    return "refunded";
  }
}

/** Bewertung nach dem Bezahlen: einmal pro Zahlung. */
export async function submitFeedback(paymentToken: string, stars: number, comment: string): Promise<void> {
  const p = await paymentByToken(paymentToken);
  if (!p || p.status !== "paid") throw new PosError("Zahlung nicht gefunden.");
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new PosError("Bewertung: 1 bis 5 Sterne.");
  await db().insert(tableFeedback).values({ hotelId: p.hotelId, tablePaymentId: p.id, stars, comment: comment.trim().slice(0, 1000) }).onConflictDoNothing();
}

export async function feedbackOf(paymentId: string) {
  const [f] = await db().select().from(tableFeedback).where(eq(tableFeedback.tablePaymentId, paymentId));
  return f ?? null;
}

export async function reviewUrl(hotelId: string): Promise<string> {
  const [s] = await db().select({ u: restaurantSettings.reviewUrl }).from(restaurantSettings).where(eq(restaurantSettings.hotelId, hotelId));
  return s?.u ?? "";
}

export async function saveReviewUrl(hotelId: string, url: string, actor: string) {
  const u = url.trim();
  if (u && !/^https:\/\/[^\s]+$/.test(u)) throw new PosError("Der Link muss mit https:// beginnen.");
  const upd = await db().update(restaurantSettings).set({ reviewUrl: u }).where(eq(restaurantSettings.hotelId, hotelId)).returning({ id: restaurantSettings.hotelId });
  if (!upd.length) await db().insert(restaurantSettings).values({ hotelId, reviewUrl: u, windows: [{ from: "11:30", to: "13:30" }, { from: "18:00", to: "21:00" }] });
  await audit(db(), { hotelId, actor, action: "restaurant.review_url" });
}
