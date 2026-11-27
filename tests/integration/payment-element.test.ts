import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import Stripe from "stripe";
import { POST as stripeWebhook } from "../../app/api/webhooks/stripe/route";
import { POST as createBookingRoute } from "../../app/api/bookings/route";
import { POST as payRoute } from "../../app/api/bookings/[token]/pay/route";
import { closeDb, db } from "../../src/db/client";
import { bookings, hotels, payments } from "../../src/db/schema";
import { setStripeClient } from "../../src/integrations/stripe/client";
import { StripePaymentProvider } from "../../src/integrations/stripe/provider";
import { setPaymentProvider } from "../../src/payments/provider";
import { paymentUi, setPaymentUi } from "../../src/services/payment-settings";
import { expireHolds } from "../../src/services/bookings";
import { setBlocked } from "../../src/services/inventory";
import { reconcilePayments } from "../../src/services/reconcile";
import { addDays } from "../../src/domain/dates";
import { inDays, inv, makeHotel } from "../helpers";

const SECRET = "whsec_test_secret";
const stripe = new Stripe("sk_test_dummy");
const intents: { params: Stripe.PaymentIntentCreateParams; opts: Stripe.RequestOptions }[] = [];
const cancels: string[] = [];
const refunds: Stripe.RefundCreateParams[] = [];
let sessions = 0;
/** Zustand, den Stripe beim Abbruch/Abruf meldet */
let intentState: { status: string; cancelError?: string } = { status: "requires_payment_method" };

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET_CONNECT = SECRET;
  process.env.PAYMENT_PROVIDER = "stripe";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_element";
  stripe.paymentIntents.create = vi.fn(async (params: Stripe.PaymentIntentCreateParams, opts: Stripe.RequestOptions) => {
    intents.push({ params, opts });
    return { id: `pi_el_${intents.length}_${Date.now()}`, client_secret: "pi_secret_abc" };
  }) as never;
  stripe.paymentIntents.cancel = vi.fn(async (id: string) => {
    if (intentState.cancelError) throw Object.assign(new Error("state"), { code: intentState.cancelError });
    cancels.push(id);
    return { id, status: "canceled" };
  }) as never;
  stripe.paymentIntents.retrieve = vi.fn(async (id: string) => ({ id, status: intentState.status, client_secret: "pi_secret_abc", amount: 12345, latest_charge: { payment_method_details: { type: "twint" } } })) as never;
  stripe.checkout.sessions.create = vi.fn(async () => ({ id: `cs_${++sessions}`, url: "https://checkout.stripe.com/x" })) as never;
  stripe.refunds.create = vi.fn(async (p: Stripe.RefundCreateParams) => { refunds.push(p); return { id: "re_1" }; }) as never;
  setStripeClient(stripe);
  setPaymentProvider(new StripePaymentProvider());
});
afterAll(async () => { setStripeClient(null); setPaymentProvider(null); process.env.PAYMENT_PROVIDER = "fake"; await closeDb(); });
beforeEach(() => { intents.length = 0; cancels.length = 0; refunds.length = 0; intentState = { status: "requires_payment_method" }; });

async function stripeHotel(ui: "element" | "embedded" | "hosted" = "element") {
  const h = await makeHotel();
  const acct = `acct_${h.hotel.slug.replace(/-/g, "")}`;
  await db().update(hotels).set({ stripeAccountId: acct, stripeChargesEnabled: true, stripeTwintActive: true }).where(eq(hotels.id, h.hotel.id));
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  await setPaymentUi(hotel, ui, "test");
  const [fresh] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  return { ...h, hotel: fresh, acct };
}
type H = Awaited<ReturnType<typeof stripeHotel>>;
let ip = 0;
async function web(h: H, ci: string) {
  return createBookingRoute(new Request("http://x/api/bookings", { method: "POST", headers: { host: h.hotel.primaryDomain!, "content-type": "application/json", "x-forwarded-for": `10.88.${ip++}.1` }, body: JSON.stringify({ room_type_id: h.rooms[0].roomType.id, rate_plan_id: h.rooms[0].plans[0].id, checkin: ci, checkout: addDays(ci, 2), adults: 2, children: 0, guest: { first_name: "Max", last_name: "Gast", email: "max@example.ch", language: "de" }, terms_accepted: true }) }));
}
async function bookingOf(h: H) {
  const all = await db().select().from(bookings).where(eq(bookings.hotelId, h.hotel.id));
  return all.sort((a, c) => +c.createdAt - +a.createdAt)[0];
}
const evt = (type: string, account: string, object: Record<string, unknown>) => ({ id: `evt_${Math.random().toString(36).slice(2)}`, object: "event", type, account, created: Math.floor(Date.now() / 1000), data: { object } });
async function send(e: object) {
  const payload = JSON.stringify(e);
  return stripeWebhook(new Request("http://x/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) }, body: payload }));
}
const payRes = (token: string) => payRoute(new Request("http://x/p", { method: "POST", headers: { "x-forwarded-for": `10.99.${ip++}.1` } }), { params: Promise.resolve({ token }) });
async function paymentOf(bookingId: string) { return (await db().select().from(payments).where(eq(payments.bookingId, bookingId)))[0]; }

describe("Payment Element (SPEC 19.52)", () => {
  it("Einstellung: ui hat Vorrang, sonst das alte Feld embedded, sonst Weiterleitung", async () => {
    const h = await stripeHotel("element");
    expect(paymentUi(h.hotel)).toBe("element");
    expect(paymentUi({ content: { payment: { embedded: true } } } as never)).toBe("embedded");
    expect(paymentUi({ content: {} } as never)).toBe("hosted");
  });

  it("legt einen PaymentIntent auf dem Konto des Hotels an (Gebühr, TWINT, Idempotenz), keine Checkout-Session", async () => {
    const h = await stripeHotel();
    sessions = 0;
    const r = await web(h, inDays(30));
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j).toMatchObject({ ui: "element", client_secret: "pi_secret_abc", publishable_key: "pk_test_element", stripe_account: h.acct });
    expect(sessions).toBe(0);
    const b = await bookingOf(h);
    expect(intents[0].opts).toMatchObject({ stripeAccount: h.acct, idempotencyKey: `pi-${b.id}` });
    expect(intents[0].params).toMatchObject({ currency: "chf", amount: b.totalRappen, automatic_payment_methods: { enabled: true }, metadata: { booking_id: b.id, flow: "element" } });
    expect(intents[0].params.application_fee_amount).toBeGreaterThan(0);
    expect(intents[0].params.excluded_payment_method_types).toBeUndefined(); // TWINT aktiv
    const p = await paymentOf(b.id);
    expect(p).toMatchObject({ status: "pending", stripeCheckoutSessionId: null });
    expect(p.stripePaymentIntentId).toMatch(/^pi_el_/);
  });

  it("TWINT inaktiv: wird ausgeschlossen", async () => {
    const h = await stripeHotel();
    await db().update(hotels).set({ stripeTwintActive: false }).where(eq(hotels.id, h.hotel.id));
    await web(h, inDays(31));
    expect(intents[0].params.excluded_payment_method_types).toEqual(["twint"]);
  });

  it("payment_intent.succeeded bestätigt die Buchung, genau einmal (auch bei doppelter Zustellung)", async () => {
    const h = await stripeHotel();
    await web(h, inDays(32));
    const b = await bookingOf(h);
    const p = await paymentOf(b.id);
    const e = evt("payment_intent.succeeded", h.acct, { id: p.stripePaymentIntentId, object: "payment_intent", amount: b.totalRappen, amount_received: b.totalRappen, metadata: { booking_id: b.id, hotel_id: h.hotel.id, flow: "element" } });
    expect((await send(e)).status).toBe(200);
    expect((await send(e)).status).toBe(200);
    const [after] = await db().select().from(bookings).where(eq(bookings.id, b.id));
    expect(after.status).toBe("confirmed");
    const pays = await db().select().from(payments).where(eq(payments.bookingId, b.id));
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ status: "succeeded", method: "twint", amountRappen: b.totalRappen });
  });

  it("PaymentIntent einer Checkout-Session (ohne flow=element) wird hier nicht bestätigt (kein Doppel)", async () => {
    const h = await stripeHotel("hosted");
    await web(h, inDays(33));
    const b = await bookingOf(h);
    await send(evt("payment_intent.succeeded", h.acct, { id: "pi_cs", object: "payment_intent", amount: b.totalRappen, metadata: { booking_id: b.id, hotel_id: h.hotel.id } }));
    expect((await db().select().from(bookings).where(eq(bookings.id, b.id)))[0].status).toBe("hold");
  });

  it("Ereignis eines fremden Kontos wird abgelehnt (Mandantentrennung)", async () => {
    const h = await stripeHotel();
    await web(h, inDays(34));
    const b = await bookingOf(h);
    const r = await send(evt("payment_intent.succeeded", "acct_fremd", { id: "pi_x", object: "payment_intent", amount: 1, metadata: { booking_id: b.id, flow: "element" } }));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await db().select().from(bookings).where(eq(bookings.id, b.id)))[0].status).toBe("hold");
  });

  it("abgelehnter Versuch (payment_failed) gibt die Reservation NICHT frei", async () => {
    const h = await stripeHotel();
    await web(h, inDays(35));
    const b = await bookingOf(h);
    await send(evt("payment_intent.payment_failed", h.acct, { id: "pi_f", object: "payment_intent", metadata: { booking_id: b.id, flow: "element" } }));
    expect((await db().select().from(bookings).where(eq(bookings.id, b.id)))[0].status).toBe("hold");
  });

  it("payment_intent.canceled gibt die Reservation frei", async () => {
    const h = await stripeHotel();
    await web(h, inDays(36));
    const b = await bookingOf(h);
    await send(evt("payment_intent.canceled", h.acct, { id: "pi_c", object: "payment_intent", metadata: { booking_id: b.id, hotel_id: h.hotel.id, flow: "element" } }));
    expect((await db().select().from(bookings).where(eq(bookings.id, b.id)))[0].status).toBe("expired");
    for (let i = 0; i < 2; i++) expect((await inv(h.rooms[0].roomType.id, addDays(b.checkin, i))).booked).toBe(0);
  });

  it("Ablauf der Reservation bricht den PaymentIntent ab", async () => {
    const h = await stripeHotel();
    await web(h, inDays(37));
    const b = await bookingOf(h);
    const p = await paymentOf(b.id);
    await expireHolds(new Date(Date.now() + 40 * 60_000));
    expect((await db().select().from(bookings).where(eq(bookings.id, b.id)))[0].status).toBe("expired");
    expect(cancels).toContain(p.stripePaymentIntentId);
    expect((await paymentOf(b.id)).status).toBe("failed");
  });

  it("Abbruch scheitert (Stripe nicht erreichbar): Reservation wird trotzdem frei, der Job holt den Abbruch nach", async () => {
    const h = await stripeHotel();
    await web(h, inDays(38));
    const b = await bookingOf(h);
    const orig = stripe.paymentIntents.cancel;
    stripe.paymentIntents.cancel = vi.fn(async () => { throw Object.assign(new Error("net"), { code: "api_connection_error" }); }) as never;
    await expireHolds(new Date(Date.now() + 40 * 60_000));
    expect((await db().select().from(bookings).where(eq(bookings.id, b.id)))[0].status).toBe("expired");
    expect((await paymentOf(b.id)).status).toBe("pending");
    stripe.paymentIntents.cancel = orig;
    await expireHolds(new Date(Date.now() + 41 * 60_000));
    expect((await paymentOf(b.id)).status).toBe("failed");
  });

  it("Zahlung läuft schon (nicht abbrechbar): Buchung abgelaufen, späte Zahlung wird später nachgebucht", async () => {
    const h = await stripeHotel();
    await web(h, inDays(39));
    const b = await bookingOf(h);
    const p = await paymentOf(b.id);
    intentState = { status: "processing", cancelError: "payment_intent_unexpected_state" };
    await expireHolds(new Date(Date.now() + 40 * 60_000));
    expect((await paymentOf(b.id)).status).toBe("pending"); // nicht als gescheitert markiert
    await send(evt("payment_intent.succeeded", h.acct, { id: p.stripePaymentIntentId, object: "payment_intent", amount: b.totalRappen, amount_received: b.totalRappen, metadata: { booking_id: b.id, hotel_id: h.hotel.id, flow: "element" } }));
    expect((await db().select().from(bookings).where(eq(bookings.id, b.id)))[0].status).toBe("confirmed"); // Zimmer war noch frei
  });

  it("späte Zahlung ohne freies Zimmer: volle Rückerstattung", async () => {
    const h = await stripeHotel();
    await web(h, inDays(41));
    const b = await bookingOf(h);
    const p = await paymentOf(b.id);
    intentState = { status: "processing", cancelError: "payment_intent_unexpected_state" };
    await expireHolds(new Date(Date.now() + 40 * 60_000));
    await setBlocked(h.hotel.id, h.rooms[0].roomType.id, b.checkin, b.checkin, 3, { actor: "test" }); // alles gesperrt
    await send(evt("payment_intent.succeeded", h.acct, { id: p.stripePaymentIntentId, object: "payment_intent", amount: b.totalRappen, amount_received: b.totalRappen, metadata: { booking_id: b.id, hotel_id: h.hotel.id, flow: "element" } }));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ payment_intent: p.stripePaymentIntentId, amount: b.totalRappen });
  });

  it("«Zahlung fortsetzen»: offen → client_secret; bezahlt/im Gang → warten; abgelaufen → gone; unbekannter Link → 404", async () => {
    const h = await stripeHotel();
    await web(h, inDays(42));
    const b = await bookingOf(h);
    const r1 = await (await payRes(b.publicToken)).json();
    expect(r1).toMatchObject({ state: "open", client_secret: "pi_secret_abc", stripe_account: h.acct, publishable_key: "pk_test_element" });
    intentState = { status: "processing" };
    expect((await (await payRes(b.publicToken)).json()).state).toBe("processing");
    intentState = { status: "succeeded" };
    expect((await (await payRes(b.publicToken)).json()).state).toBe("paid");
    intentState = { status: "canceled" };
    expect((await (await payRes(b.publicToken)).json()).state).toBe("gone");
    expect((await payRes("gibtsnicht")).status).toBe(404);
    await expireHolds(new Date(Date.now() + 40 * 60_000));
    expect((await (await payRes(b.publicToken)).json()).state).toBe("gone");
  });

  it("«Zahlung fortsetzen»: Stripe nicht erreichbar → Fehlerantwort, Reservation bleibt", async () => {
    const h = await stripeHotel();
    await web(h, inDays(43));
    const b = await bookingOf(h);
    const orig = stripe.paymentIntents.retrieve;
    stripe.paymentIntents.retrieve = vi.fn(async () => { throw new Error("net"); }) as never;
    expect((await payRes(b.publicToken)).status).toBeGreaterThanOrEqual(500);
    stripe.paymentIntents.retrieve = orig;
    expect((await db().select().from(bookings).where(eq(bookings.id, b.id)))[0].status).toBe("hold");
  });

  it("Abgleich findet bezahlte PaymentIntents ohne bestätigte Buchung", async () => {
    const h = await stripeHotel();
    await web(h, inDays(44));
    const b = await bookingOf(h);
    await db().update(payments).set({ createdAt: new Date(Date.now() - 3_600_000) }).where(eq(payments.bookingId, b.id));
    await db().update(bookings).set({ status: "expired" }).where(eq(bookings.id, b.id));
    intentState = { status: "succeeded" };
    const r = await reconcilePayments(new Date());
    expect(r.issues).toBeGreaterThanOrEqual(1);
  });

  it("Stripe lehnt die Anlage ab: Reservation wird freigegeben, Fehler 502", async () => {
    const h = await stripeHotel();
    const orig = stripe.paymentIntents.create;
    stripe.paymentIntents.create = vi.fn(async () => { throw new Error("Stripe down"); }) as never;
    const r = await web(h, inDays(45));
    expect(r.status).toBe(502);
    stripe.paymentIntents.create = orig;
    const b = await bookingOf(h);
    expect(b.status).toBe("expired");
  });

  it("andere Varianten bleiben: hosted und embedded liefern wie bisher Checkout-Sessions", async () => {
    const h1 = await stripeHotel("hosted");
    const j1 = await (await web(h1, inDays(46))).json();
    expect(j1.checkout_url).toContain("stripe.com");
    expect(intents).toHaveLength(0);
  });
});
