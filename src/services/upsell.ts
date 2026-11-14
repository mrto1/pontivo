import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, rows, type Executor } from "../db/client";
import { bookings, guests, hotelModules, hotels, upsellItems, upsellOrders, type Booking, type Hotel, type UpsellItem, type UpsellOrder, type L10n } from "../db/schema";
import { addDays, diffDays, todayIn, zonedToUtc } from "../domain/dates";
import { EXTRA_UNITS } from "../domain/extras";
import { formatChf } from "../domain/money";
import { priceSelection, upsellFee, UPSELL_PROVISION_BPS, UpsellError } from "../domain/upsell";
import { enqueueEmail } from "../email/enqueue";
import { enqueuePush } from "../push/service";
import { env } from "../env";
import { HOST_TERMS_VERSION } from "../legal/host-terms";
import { getPaymentProvider } from "../payments/provider";
import { isLocale, type Locale } from "../i18n/dict";
import { tr } from "../domain/blocks";
import { audit } from "./audit";
import { isBookable } from "./hotels";

/**
 * Modul «Upselling» (SPEC 14d): Der Gast bekommt vor der Anreise eine Mail mit Zusatzangeboten des Hauses
 * und bezahlt sie per Stripe (Direct Charge). Pontivo behält 5 % Provision als application fee. Keine Grundgebühr.
 */

export { UpsellError };
export const UPSELL_MODULE = "upsell";
/** Angebots-Mail so viele Tage vor der Anreise */
export const OFFER_DAYS_BEFORE = 7;

export type UpsellSettings = { enabledSince?: string; endsAt?: string | null; terms?: { provisionBps: number; acceptedAt: string; acceptedBy: string; termsVersion: string } };

export async function upsellRow(hotelId: string, ex: Executor = db()): Promise<{ enabled: boolean; settings: UpsellSettings }> {
  const [m] = await ex.select().from(hotelModules).where(and(eq(hotelModules.hotelId, hotelId), eq(hotelModules.module, UPSELL_MODULE)));
  return { enabled: !!m?.enabled, settings: (m?.settings ?? {}) as UpsellSettings };
}

/** Läuft Upselling für dieses Hotel? Modul an und Online-Zahlung eingerichtet. */
export async function upsellActive(hotel: Hotel, ex: Executor = db()): Promise<boolean> {
  const m = await upsellRow(hotel.id, ex);
  return m.enabled && isBookable(hotel, env().PAYMENT_PROVIDER);
}

export async function enableUpsell(hotel: Hotel, confirmedBps: number, actor: string, now = new Date()): Promise<void> {
  if (confirmedBps !== UPSELL_PROVISION_BPS) throw new UpsellError("invalid_selection"); // Konditionen haben sich geändert
  const settings: UpsellSettings = { enabledSince: todayIn(hotel.timezone, now), endsAt: null, terms: { provisionBps: UPSELL_PROVISION_BPS, acceptedAt: now.toISOString(), acceptedBy: actor, termsVersion: HOST_TERMS_VERSION } };
  await db().transaction(async (tx) => {
    await tx.insert(hotelModules).values({ hotelId: hotel.id, module: UPSELL_MODULE, enabled: true, settings })
      .onConflictDoUpdate({ target: [hotelModules.hotelId, hotelModules.module], set: { enabled: true, settings } });
    await audit(tx, { hotelId: hotel.id, actor, action: "module.upsell.on", entity: "hotel", entityId: hotel.id, details: { provisionBps: UPSELL_PROVISION_BPS } });
  });
}

/** Ausschalten: sofort. Es gibt keine Grundgebühr, also keine Kündigungsfrist. Geplante Angebots-Mails werden gelöscht. */
export async function disableUpsell(hotel: Hotel, actor: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.update(hotelModules).set({ enabled: false }).where(and(eq(hotelModules.hotelId, hotel.id), eq(hotelModules.module, UPSELL_MODULE)));
    await tx.execute(sql`UPDATE email_outbox SET status = 'cancelled' WHERE hotel_id = ${hotel.id} AND status = 'pending' AND template = 'upsell_offer'`);
    await audit(tx, { hotelId: hotel.id, actor, action: "module.upsell.off", entity: "hotel", entityId: hotel.id, details: {} });
  });
}

// ---------------------------------------------------------------- Angebote

export const itemSchema = z.object({
  nameDe: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().max(120).default(""),
  descDe: z.string().trim().max(400).default(""),
  descEn: z.string().trim().max(400).default(""),
  priceRappen: z.number().int().min(100).max(1_000_000),
  unit: z.enum(EXTRA_UNITS),
  maxQuantity: z.number().int().min(1).max(20).default(1),
});

export async function listItems(hotelId: string, onlyActive = false): Promise<UpsellItem[]> {
  return db().select().from(upsellItems).where(and(eq(upsellItems.hotelId, hotelId), onlyActive ? eq(upsellItems.active, true) : sql`true`)).orderBy(asc(upsellItems.sortOrder), asc(upsellItems.createdAt));
}

export async function addItem(hotelId: string, input: z.input<typeof itemSchema>, actor: string): Promise<UpsellItem> {
  const v = itemSchema.parse(input);
  const name: L10n = { de: v.nameDe, ...(v.nameEn ? { en: v.nameEn } : {}) };
  const description: L10n = { ...(v.descDe ? { de: v.descDe } : {}), ...(v.descEn ? { en: v.descEn } : {}) };
  return db().transaction(async (tx) => {
    const [item] = await tx.insert(upsellItems).values({ hotelId, name, description, priceRappen: v.priceRappen, unit: v.unit, maxQuantity: v.maxQuantity }).returning();
    await audit(tx, { hotelId, actor, action: "upsell.item.add", entity: "upsell_item", entityId: item.id, details: { price: v.priceRappen, unit: v.unit } });
    return item;
  });
}

export async function setItemActive(hotelId: string, itemId: string, active: boolean, actor: string): Promise<void> {
  await db().update(upsellItems).set({ active }).where(and(eq(upsellItems.id, itemId), eq(upsellItems.hotelId, hotelId)));
  await audit(db(), { hotelId, actor, action: active ? "upsell.item.on" : "upsell.item.off", entity: "upsell_item", entityId: itemId, details: {} });
}

export async function deleteItem(hotelId: string, itemId: string, actor: string): Promise<void> {
  // Bestellungen speichern eine Momentaufnahme, Löschen ist deshalb unbedenklich
  await db().delete(upsellItems).where(and(eq(upsellItems.id, itemId), eq(upsellItems.hotelId, hotelId)));
  await audit(db(), { hotelId, actor, action: "upsell.item.delete", entity: "upsell_item", entityId: itemId, details: {} });
}

// ---------------------------------------------------------------- Angebots-Mail

/**
 * Angebots-Mail einreihen: nur mit Einwilligung des Gastes (UWG), nur wenn das Modul läuft und Angebote existieren.
 * 7 Tage vor Anreise, 10:00 Hotelzeit; liegt das schon in der Vergangenheit, sofort (sofern die Anreise noch bevorsteht).
 */
export async function enqueueUpsellOffer(tx: Executor, hotel: Hotel, booking: Booking, guest: { email: string; marketingConsent: boolean }, now: Date): Promise<boolean> {
  if (!guest.email || !guest.marketingConsent) return false;
  if (booking.checkin <= todayIn(hotel.timezone, now)) return false;
  if (!(await upsellActive(hotel, tx))) return false;
  const [cnt] = rows<{ n: number }>(await tx.execute(sql`SELECT count(*)::int AS n FROM upsell_items WHERE hotel_id = ${hotel.id} AND active`));
  if (!cnt.n) return false;
  const at = zonedToUtc(addDays(booking.checkin, -OFFER_DAYS_BEFORE), "10:00", hotel.timezone);
  await enqueueEmail(tx, { hotelId: hotel.id, bookingId: booking.id, template: "upsell_offer", to: guest.email, language: booking.language, data: { bookingId: booking.id }, sendAfter: at < now ? now : at });
  return true;
}

// ---------------------------------------------------------------- Angebotsseite und Kauf

export type Offer = { booking: Booking; hotel: Hotel; items: UpsellItem[]; nights: number; persons: number };

/** Angebot für eine Buchung (per Buchungslink). null = nicht (mehr) verfügbar. */
export async function offerForBooking(token: string, now = new Date()): Promise<Offer | null> {
  const [booking] = await db().select().from(bookings).where(eq(bookings.publicToken, token));
  if (!booking || booking.status !== "confirmed") return null;
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, booking.hotelId));
  if (!hotel || booking.checkout < todayIn(hotel.timezone, now)) return null;
  if (!(await upsellActive(hotel))) return null;
  const items = await listItems(hotel.id, true);
  if (!items.length) return null;
  return { booking, hotel, items, nights: diffDays(booking.checkin, booking.checkout), persons: booking.adults + booking.children };
}

export async function startUpsell(token: string, selection: { id: string; quantity: number }[], source: "email" | "chat" = "email", now = new Date()): Promise<{ url: string; order: UpsellOrder }> {
  const offer = await offerForBooking(token, now);
  if (!offer) throw new UpsellError("not_available");
  const { booking, hotel } = offer;
  const { lines, totalRappen } = priceSelection(offer.items, selection, { nights: offer.nights, persons: offer.persons });
  const [guest] = booking.guestId ? await db().select().from(guests).where(eq(guests.id, booking.guestId)) : [];
  const bps = (await upsellRow(hotel.id)).settings.terms?.provisionBps ?? UPSELL_PROVISION_BPS;
  const fee = upsellFee(totalRappen, bps);
  const [order] = await db().insert(upsellOrders).values({
    hotelId: hotel.id, bookingId: booking.id, amountRappen: totalRappen, feeRappen: fee, feeBps: bps, source,
    lines: lines.map((l) => ({ name: l.item.name, quantity: l.quantity, amountRappen: l.amountRappen })),
  }).returning();
  const lang: Locale = isLocale(booking.language) ? booking.language : "de";
  const provider = await getPaymentProvider();
  const base = env().APP_BASE_URL;
  const checkout = await provider.createPaymentCheckout({
    hotel, amountRappen: totalRappen, feeRappen: fee, email: guest?.email ?? hotel.contactEmail, lang,
    description: `${hotel.name} – ${lines.map((l) => `${l.quantity}× ${tr(l.item.name, lang)}`).join(", ")}`.slice(0, 250),
    successUrl: `${base}/b/${booking.publicToken}/upsell?paid=1`, cancelUrl: `${base}/b/${booking.publicToken}/upsell`,
    metadata: { upsell_order_id: order.id, booking_id: booking.id }, reference: booking.reference, idempotencyKey: `upsell-${order.id}`,
  });
  await db().update(upsellOrders).set({ stripeSessionId: checkout.sessionId }).where(eq(upsellOrders.id, order.id));
  if (provider.confirmsImmediately) await markUpsellPaid(order.id, { sessionId: checkout.sessionId, paymentIntentId: null });
  return { url: checkout.url, order };
}

/** Zahlung bestätigt (Webhook oder Fake) – idempotent */
export async function markUpsellPaid(orderId: string, p: { sessionId: string | null; paymentIntentId: string | null }): Promise<void> {
  await db().transaction(async (tx) => {
    const [o] = await tx.select().from(upsellOrders).where(eq(upsellOrders.id, orderId)).for("update");
    if (!o || o.status === "paid") return;
    await tx.update(upsellOrders).set({ status: "paid", paidAt: new Date(), stripePaymentIntentId: p.paymentIntentId, stripeSessionId: p.sessionId ?? o.stripeSessionId }).where(eq(upsellOrders.id, o.id));
    const [h] = await tx.select().from(hotels).where(eq(hotels.id, o.hotelId));
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, o.bookingId));
    const [g] = b.guestId ? await tx.select().from(guests).where(eq(guests.id, b.guestId)) : [];
    const data = { bookingId: b.id, upsellOrderId: o.id, amountRappen: o.amountRappen, lines: o.lines };
    // Bestätigung an den Gast ist eine Transaktions-Mail (Bestellung), keine Werbung
    if (g?.email) await enqueueEmail(tx, { hotelId: h.id, bookingId: b.id, template: "upsell_paid", to: g.email, language: b.language, data });
    await enqueueEmail(tx, { hotelId: h.id, bookingId: b.id, template: "hotel_upsell_sold", to: h.contactEmail, language: h.defaultLanguage, data });
    await enqueuePush(tx, h.id, `upsell:${o.id}`, { title: "Extras verkauft", body: `${formatChf(o.amountRappen)} – ${b.reference}`, url: `/admin/${h.id}/upsell` });
    await audit(tx, { hotelId: h.id, actor: "payment", action: "upsell.paid", entity: "upsell_order", entityId: o.id, details: { amount: o.amountRappen, fee: o.feeRappen, bookingId: b.id } });
  });
}

export async function cancelPendingUpsell(orderId: string): Promise<void> {
  await db().update(upsellOrders).set({ status: "cancelled" }).where(and(eq(upsellOrders.id, orderId), eq(upsellOrders.status, "pending")));
}

// ---------------------------------------------------------------- Admin-Übersicht

export async function upsellStats(hotelId: string): Promise<{ orders: number; amountRappen: number; feeRappen: number; recent: (UpsellOrder & { reference: string })[] }> {
  const [s] = rows<{ n: number; a: number; f: number }>(await db().execute(sql`SELECT count(*)::int AS n, coalesce(sum(amount_rappen),0)::int AS a, coalesce(sum(fee_rappen),0)::int AS f FROM upsell_orders WHERE hotel_id = ${hotelId} AND status = 'paid'`));
  const recent = await db().select({ o: upsellOrders, reference: bookings.reference }).from(upsellOrders).innerJoin(bookings, eq(bookings.id, upsellOrders.bookingId))
    .where(and(eq(upsellOrders.hotelId, hotelId), eq(upsellOrders.status, "paid"))).orderBy(desc(upsellOrders.paidAt)).limit(30);
  return { orders: s.n, amountRappen: s.a, feeRappen: s.f, recent: recent.map((r) => ({ ...r.o, reference: r.reference })) };
}
