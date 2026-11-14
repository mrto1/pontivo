import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import Stripe from "stripe";
import { POST as stripeWebhook } from "../../app/api/webhooks/stripe/route";
import { POST as createBookingRoute } from "../../app/api/bookings/route";
import { db, closeDb } from "../../src/db/client";
import { bookings, emailOutbox, hotels, payments, upsellOrders } from "../../src/db/schema";
import { setStripeClient } from "../../src/integrations/stripe/client";
import { StripePaymentProvider } from "../../src/integrations/stripe/provider";
import { setPaymentProvider } from "../../src/payments/provider";
import { addItem, disableUpsell, enableUpsell, offerForBooking, startUpsell, UpsellError } from "../../src/services/upsell";
import { UPSELL_PROVISION_BPS } from "../../src/domain/upsell";
import { addDays, todayIn } from "../../src/domain/dates";
import { inDays, makeHotel } from "../helpers";

const SECRET = "whsec_test_secret";
const stripe = new Stripe("sk_test_dummy");
const created: { params: Stripe.Checkout.SessionCreateParams; opts: Stripe.RequestOptions }[] = [];
const refunds: { params: Stripe.RefundCreateParams; opts: Stripe.RequestOptions }[] = [];

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET_CONNECT = SECRET;
  process.env.PAYMENT_PROVIDER = "stripe";
  stripe.checkout.sessions.create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams, opts: Stripe.RequestOptions) => {
    created.push({ params, opts });
    return { id: `cs_test_${created.length}_${Math.random().toString(36).slice(2)}`, url: "https://checkout.stripe.com/c/pay/test" };
  }) as never;
  stripe.refunds.create = vi.fn(async (params: Stripe.RefundCreateParams, opts: Stripe.RequestOptions) => {
    refunds.push({ params, opts });
    return { id: `re_${refunds.length}` };
  }) as never;
  stripe.paymentIntents.retrieve = vi.fn(async () => ({ latest_charge: { payment_method_details: { type: "card" } } })) as never;
  setStripeClient(stripe);
  setPaymentProvider(new StripePaymentProvider());
});
afterAll(async () => {
  setStripeClient(null);
  setPaymentProvider(null);
  process.env.PAYMENT_PROVIDER = "fake";
  await closeDb();
});
beforeEach(() => {
  created.length = 0;
  refunds.length = 0;
});

let ip = 0;
async function setup(depositBps = 10000) {
  const h = await makeHotel();
  const acct = `acct_${h.hotel.slug.replace(/-/g, "")}`;
  await db().update(hotels).set({ stripeAccountId: acct, stripeChargesEnabled: true, stripeTwintActive: true, depositBps, balanceDueDays: 7 }).where(eq(hotels.id, h.hotel.id));
  return { ...h, acct };
}
type H = Awaited<ReturnType<typeof setup>>;

async function book(h: H, checkin: string, nights = 2, consent = true) {
  const res = await createBookingRoute(new Request("http://x/api/bookings", {
    method: "POST",
    headers: { host: h.hotel.primaryDomain!, "content-type": "application/json", "x-forwarded-for": `10.61.${ip++}.1` },
    body: JSON.stringify({ room_type_id: h.rooms[0].roomType.id, rate_plan_id: h.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, nights), adults: 2, children: 0,
      guest: { first_name: "Max", last_name: "Gast", email: "max@example.ch", language: "de", marketing_consent: consent }, terms_accepted: true }),
  }));
  expect(res.status).toBe(201);
  return (await db().select().from(bookings).where(eq(bookings.hotelId, h.hotel.id))).sort((a, c) => +c.createdAt - +a.createdAt)[0];
}

async function send(evt: object) {
  const payload = JSON.stringify(evt);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return stripeWebhook(new Request("http://x/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": header }, body: payload }));
}
const evt = (type: string, account: string, object: Record<string, unknown>) => ({ id: `evt_${Math.random().toString(36).slice(2)}`, object: "event", type, account, created: Math.floor(Date.now() / 1000), data: { object } });
const session = (id: string, b: { id: string; hotelId: string }, amount: number, pi: string, kind?: "balance") => ({
  id, object: "checkout.session", payment_status: "paid", payment_intent: pi, amount_total: amount, metadata: { booking_id: b.id, hotel_id: b.hotelId, ...(kind ? { kind } : {}) },
});
const get = async (id: string) => (await db().select().from(bookings).where(eq(bookings.id, id)))[0];
const pays = (id: string) => db().select().from(payments).where(eq(payments.bookingId, id)).orderBy(payments.createdAt);
const mails = async (id: string, template: string) => (await db().select().from(emailOutbox).where(and(eq(emailOutbox.bookingId, id), eq(emailOutbox.template, template as never)))).length;


const orderSession = (id: string, o: { id: string; hotelId: string; bookingId: string }, amount: number, pi: string) => ({
  id, object: "checkout.session", payment_status: "paid", payment_intent: pi, amount_total: amount, metadata: { upsell_order_id: o.id, booking_id: o.bookingId, hotel_id: o.hotelId },
});
const orders = (hotelId: string) => db().select().from(upsellOrders).where(eq(upsellOrders.hotelId, hotelId));

/** bestätigte Buchung (Vollzahlung per Webhook) */
async function confirmed(h: H, checkin = inDays(40), consent = true) {
  const b = await book(h, checkin, 2, consent);
  const [p] = await pays(b.id);
  await send(evt("checkout.session.completed", h.acct, session(p.stripeCheckoutSessionId!, b, b.totalRappen, `pi_full_${b.id.slice(0, 8)}`)));
  return get(b.id);
}

describe("Upselling (SPEC 14d)", () => {
  it("Angebots-Mail nur mit Modul, Angeboten und Einwilligung; 7 Tage vor Anreise", async () => {
    const h = await setup();
    const ref = inDays(40);
    // Modul aus: keine Mail
    const b0 = await confirmed(h, ref);
    expect(await mails(b0.id, "upsell_offer")).toBe(0);
    // Modul an, aber ohne Angebote: keine Mail
    await enableUpsell(h.hotel, UPSELL_PROVISION_BPS, "test");
    const b1 = await confirmed(h, inDays(41));
    expect(await mails(b1.id, "upsell_offer")).toBe(0);
    await addItem(h.hotel.id, { nameDe: "Frühstück", priceRappen: 1800, unit: "per_person_night", maxQuantity: 1 }, "test");
    // ohne Einwilligung keine Mail
    const b2 = await confirmed(h, inDays(42), false);
    expect(await mails(b2.id, "upsell_offer")).toBe(0);
    // mit Einwilligung: Mail 7 Tage vor Anreise
    const b3 = await confirmed(h, inDays(43), true);
    expect(await mails(b3.id, "upsell_offer")).toBe(1);
    const [m] = await db().select().from(emailOutbox).where(and(eq(emailOutbox.bookingId, b3.id), eq(emailOutbox.template, "upsell_offer")));
    expect(todayIn(h.hotel.timezone, m.sendAfter)).toBe(addDays(b3.checkin, -7));
    // Ausschalten löscht geplante Mails
    await disableUpsell(h.hotel, "test");
    const [m2] = await db().select().from(emailOutbox).where(eq(emailOutbox.id, m.id));
    expect(m2.status).toBe("cancelled");
  });

  it("Kauf: Preis nur vom Server, 5 % Provision als application fee, Zahlung per Webhook, idempotent", async () => {
    const h = await setup();
    await enableUpsell(h.hotel, UPSELL_PROVISION_BPS, "test");
    const item = await addItem(h.hotel.id, { nameDe: "Frühstück", nameEn: "Breakfast", priceRappen: 1800, unit: "per_person_night", maxQuantity: 1 }, "test");
    const b = await confirmed(h, inDays(40));
    const offer = await offerForBooking(b.publicToken);
    expect(offer?.items).toHaveLength(1);
    expect(offer?.persons).toBe(2);

    // Menge über Personenzahl wird abgelehnt
    await expect(startUpsell(b.publicToken, [{ id: item.id, quantity: 3 }])).rejects.toBeInstanceOf(UpsellError);
    await expect(startUpsell(b.publicToken, [])).rejects.toBeInstanceOf(UpsellError);

    const before = created.length;
    const { order } = await startUpsell(b.publicToken, [{ id: item.id, quantity: 2 }]);
    expect(order.amountRappen).toBe(1800 * 2 * 2);
    expect(order.feeRappen).toBe(360);
    expect(order.status).toBe("pending");
    const { params, opts } = created[before];
    expect(params.line_items?.[0].price_data?.unit_amount).toBe(7200);
    expect(params.payment_intent_data?.application_fee_amount).toBe(360);
    expect(params.metadata).toMatchObject({ upsell_order_id: order.id });
    expect(opts.stripeAccount).toBe(h.acct);

    const s = orderSession("cs_up_1", order, 7200, "pi_up_1");
    expect((await send(evt("checkout.session.completed", h.acct, s))).status).toBe(200);
    expect((await send(evt("checkout.session.completed", h.acct, s))).status).toBe(200);
    const [paid] = await orders(h.hotel.id);
    expect(paid).toMatchObject({ status: "paid", stripePaymentIntentId: "pi_up_1" });
    expect(await mails(b.id, "upsell_paid")).toBe(1);
    expect(await mails(b.id, "hotel_upsell_sold")).toBe(1);
  });

  it("abgelaufene Zahlung: Bestellung wird storniert; Ereignis eines fremden Kontos wird abgelehnt", async () => {
    const h = await setup();
    await enableUpsell(h.hotel, UPSELL_PROVISION_BPS, "test");
    const item = await addItem(h.hotel.id, { nameDe: "Late Check-out", priceRappen: 3000, unit: "per_booking", maxQuantity: 1 }, "test");
    const b = await confirmed(h, inDays(40));
    const { order } = await startUpsell(b.publicToken, [{ id: item.id, quantity: 1 }]);
    const s = orderSession("cs_up_2", order, 3000, "pi_up_2");
    expect((await send(evt("checkout.session.completed", "acct_fremd", s))).status).toBeGreaterThanOrEqual(400);
    expect((await orders(h.hotel.id))[0].status).toBe("pending");
    expect((await send(evt("checkout.session.expired", h.acct, s))).status).toBe(200);
    expect((await orders(h.hotel.id))[0].status).toBe("cancelled");
  });

  it("Modul aus, Angebot weg oder Buchung nicht bestätigt: keine Extras", async () => {
    const h = await setup();
    const item = await addItem(h.hotel.id, { nameDe: "Frühstück", priceRappen: 1800, unit: "per_person_night", maxQuantity: 1 }, "test");
    const b = await confirmed(h, inDays(40));
    expect(await offerForBooking(b.publicToken)).toBeNull(); // Modul aus
    await expect(startUpsell(b.publicToken, [{ id: item.id, quantity: 1 }])).rejects.toBeInstanceOf(UpsellError);
    await enableUpsell(h.hotel, UPSELL_PROVISION_BPS, "test");
    expect(await offerForBooking(b.publicToken)).not.toBeNull();
    await expect(enableUpsell(h.hotel, 100, "test")).rejects.toBeInstanceOf(UpsellError); // veraltete Konditionen
    const pending = await book(h, inDays(50));
    expect(await offerForBooking(pending.publicToken)).toBeNull(); // noch nicht bezahlt
  });
});
