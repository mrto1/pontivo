import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import Stripe from "stripe";
import { POST as stripeWebhook } from "../../app/api/webhooks/stripe/route";
import { POST as createBookingRoute } from "../../app/api/bookings/route";
import { POST as cancelRoute } from "../../app/api/bookings/[token]/cancel/route";
import { db, closeDb } from "../../src/db/client";
import { auditLog, bookings, channexOutbox, emailOutbox, hotels, inboundEvents, payments } from "../../src/db/schema";
import { setStripeClient } from "../../src/integrations/stripe/client";
import { StripePaymentProvider } from "../../src/integrations/stripe/provider";
import { setPaymentProvider } from "../../src/payments/provider";
import { cancelBooking, expireHolds } from "../../src/services/bookings";
import { setBlocked, updateRates } from "../../src/services/inventory";
import { addDays } from "../../src/domain/dates";
import { inDays, inv, makeHotel } from "../helpers";

const SECRET = "whsec_test_secret";
const stripe = new Stripe("sk_test_dummy");
const created: { params: Stripe.Checkout.SessionCreateParams; opts: Stripe.RequestOptions }[] = [];
const refunds: { params: Stripe.RefundCreateParams; opts: Stripe.RequestOptions }[] = [];

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET_CONNECT = SECRET;
  process.env.PAYMENT_PROVIDER = "stripe";
  // Nur die Netzwerk-Aufrufe ersetzen; Signaturprüfung bleibt echt.
  stripe.checkout.sessions.create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams, opts: Stripe.RequestOptions) => {
    created.push({ params, opts });
    return { id: `cs_test_${created.length}_${Date.now()}`, url: "https://checkout.stripe.com/c/pay/test" };
  }) as never;
  stripe.refunds.create = vi.fn(async (params: Stripe.RefundCreateParams, opts: Stripe.RequestOptions) => {
    refunds.push({ params, opts });
    return { id: `re_${refunds.length}` };
  }) as never;
  stripe.paymentIntents.retrieve = vi.fn(async () => ({ latest_charge: { payment_method_details: { type: "twint" } } })) as never;
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

async function stripeHotel(opts: { twint?: boolean } = {}) {
  const h = await makeHotel();
  const acct = `acct_${h.hotel.slug.replace(/-/g, "")}`;
  await db().update(hotels).set({ stripeAccountId: acct, stripeChargesEnabled: true, stripeTwintActive: opts.twint ?? true }).where(eq(hotels.id, h.hotel.id));
  return { ...h, acct, hotel: { ...h.hotel, stripeAccountId: acct, stripeChargesEnabled: true, stripeTwintActive: opts.twint ?? true } };
}

let ipCounter = 0;
async function book(h: Awaited<ReturnType<typeof stripeHotel>>, checkin: string, nights = 2, planIdx = 0) {
  const res = await createBookingRoute(
    new Request("http://x/api/bookings", {
      method: "POST",
      headers: { host: h.hotel.primaryDomain!, "content-type": "application/json", "x-forwarded-for": `10.50.${ipCounter++}.1` },
      body: JSON.stringify({
        room_type_id: h.rooms[0].roomType.id,
        rate_plan_id: h.rooms[0].plans[planIdx].id,
        checkin,
        checkout: addDays(checkin, nights),
        adults: 2,
        children: 0,
        guest: { first_name: "Max", last_name: "Gast", email: "max@example.ch", language: "de" },
        terms_accepted: true,
      }),
    }),
  );
  expect(res.status).toBe(201);
  const [b] = await db().select().from(bookings).where(eq(bookings.hotelId, h.hotel.id)).orderBy(bookings.createdAt);
  const all = await db().select().from(bookings).where(eq(bookings.hotelId, h.hotel.id));
  return all.sort((a, c) => +c.createdAt - +a.createdAt)[0] ?? b;
}

function event(type: string, account: string, object: Record<string, unknown>, id = `evt_${Math.random().toString(36).slice(2)}`) {
  return { id, object: "event", type, account, created: Math.floor(Date.now() / 1000), data: { object } };
}

async function send(evt: object) {
  const payload = JSON.stringify(evt);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return stripeWebhook(new Request("http://x/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": header }, body: payload }));
}

async function sessionOf(bookingId: string) {
  const [p] = await db().select().from(payments).where(eq(payments.bookingId, bookingId));
  return p.stripeCheckoutSessionId!;
}

function completed(sessionId: string, b: { id: string; hotelId: string; totalRappen: number }, pi = `pi_${b.id.slice(0, 8)}`) {
  return {
    id: sessionId, object: "checkout.session", payment_status: "paid", payment_intent: pi,
    amount_total: b.totalRappen, metadata: { booking_id: b.id, hotel_id: b.hotelId },
  };
}

describe("M2 Stripe Connect", () => {
  it("Checkout als Direct Charge mit Application Fee 1 %; nach Webhook confirmed, payments korrekt", async () => {
    const h = await stripeHotel({ twint: true });
    const b = await book(h, inDays(30));
    expect(b.status).toBe("hold");
    expect(created).toHaveLength(1);
    const { params, opts } = created[0];
    expect(opts.stripeAccount).toBe(h.acct);
    expect(opts.idempotencyKey).toBe(`checkout-${b.id}`);
    expect(params.mode).toBe("payment");
    expect(params.currency).toBe("chf");
    expect(params.line_items?.[0].price_data?.unit_amount).toBe(b.totalRappen);
    expect(params.payment_intent_data?.application_fee_amount).toBe(Math.floor((b.totalRappen * 100 + 5000) / 10000));
    expect(params.payment_intent_data?.metadata).toEqual({ booking_id: b.id, hotel_id: h.hotel.id });
    expect(params.expires_at).toBe(Math.floor(b.holdExpiresAt!.getTime() / 1000));
    expect(params.expires_at! - Date.now() / 1000).toBeGreaterThanOrEqual(30 * 60);
    expect(params.excluded_payment_method_types).toBeUndefined(); // TWINT erlaubt

    const res = await send(event("checkout.session.completed", h.acct, completed(await sessionOf(b.id), b)));
    expect(res.status).toBe(200);
    const [after] = await db().select().from(bookings).where(eq(bookings.id, b.id));
    expect(after.status).toBe("confirmed");
    const [p] = await db().select().from(payments).where(eq(payments.bookingId, b.id));
    expect(p).toMatchObject({ status: "succeeded", stripePaymentIntentId: `pi_${b.id.slice(0, 8)}`, method: "twint", amountRappen: b.totalRappen, applicationFeeRappen: b.platformFeeRappen });
  });

  it("TWINT wird ausgeschlossen, wenn nicht aktiv", async () => {
    const h = await stripeHotel({ twint: false });
    await book(h, inDays(31));
    expect(created[0].params.excluded_payment_method_types).toEqual(["twint"]);
  });

  it("Doppelt gesendeter Webhook ändert nichts", async () => {
    const h = await stripeHotel();
    const b = await book(h, inDays(32));
    const evt = event("checkout.session.completed", h.acct, completed(await sessionOf(b.id), b), `evt_dup_${b.id}`);
    expect((await send(evt)).status).toBe(200);
    const mails1 = await db().select().from(emailOutbox).where(eq(emailOutbox.bookingId, b.id));
    const audit1 = await db().select().from(auditLog).where(eq(auditLog.entityId, b.id));
    const res2 = await send(evt);
    expect(await res2.json()).toMatchObject({ result: "duplicate" });
    expect(await db().select().from(emailOutbox).where(eq(emailOutbox.bookingId, b.id))).toHaveLength(mails1.length);
    expect(await db().select().from(auditLog).where(eq(auditLog.entityId, b.id))).toHaveLength(audit1.length);
    // Gleiches Ereignis unter neuer ID (Stripe sendet z. B. completed + async_succeeded) → ebenfalls keine Änderung
    await send(event("checkout.session.async_payment_succeeded", h.acct, completed(await sessionOf(b.id), b)));
    expect(await db().select().from(emailOutbox).where(eq(emailOutbox.bookingId, b.id))).toHaveLength(mails1.length);
    expect((await inv(h.rooms[0].roomType.id, b.checkin)).booked).toBe(1);
  });

  it("Ungültige Signatur → 400", async () => {
    const res = await stripeWebhook(new Request("http://x", { method: "POST", headers: { "stripe-signature": "t=1,v1=abc" }, body: "{}" }));
    expect(res.status).toBe(400);
  });

  it("Ereignis von fremdem Stripe-Konto bestätigt nichts", async () => {
    const h = await stripeHotel();
    const b = await book(h, inDays(33));
    const res = await send(event("checkout.session.completed", "acct_fremd", completed(await sessionOf(b.id), b)));
    expect(res.status).toBe(500);
    const [after] = await db().select().from(bookings).where(eq(bookings.id, b.id));
    expect(after.status).toBe("hold");
  });

  it("Storno vor Frist: volle Rückerstattung inkl. Gebühr", async () => {
    const h = await stripeHotel();
    const b = await book(h, inDays(20));
    await send(event("checkout.session.completed", h.acct, completed(await sessionOf(b.id), b)));
    const res = await cancelRoute(new Request("http://x", { method: "POST", headers: { "x-forwarded-for": "10.60.0.1" } }), { params: Promise.resolve({ token: b.publicToken }) });
    expect(res.status).toBe(200);
    expect(refunds).toHaveLength(1);
    expect(refunds[0].params).toEqual({ payment_intent: `pi_${b.id.slice(0, 8)}`, amount: b.totalRappen, refund_application_fee: true });
    expect(refunds[0].opts).toMatchObject({ stripeAccount: h.acct, idempotencyKey: `refund-${b.id}-${b.totalRappen}` });
    const [after] = await db().select().from(bookings).where(eq(bookings.id, b.id));
    expect(after.status).toBe("cancelled");
    expect((await inv(h.rooms[0].roomType.id, b.checkin)).booked).toBe(0);
    const [p] = await db().select().from(payments).where(eq(payments.bookingId, b.id));
    expect(p).toMatchObject({ status: "refunded", refundedRappen: b.totalRappen });
  });

  it("Storno nach Frist: Gebühr nach Rateplan (nur Kurtaxe zurück)", async () => {
    const h = await stripeHotel();
    const b = await book(h, inDays(1)); // Flexibel, 48 h → Frist vorbei
    await send(event("checkout.session.completed", h.acct, completed(await sessionOf(b.id), b)));
    const r = await cancelBooking(b.id, { by: "guest", actor: "guest" });
    expect(r).toEqual({ refundRappen: b.touristTaxRappen, voucherBackRappen: 0, feeRappen: b.roomsTotalRappen });
    expect(refunds[0].params.amount).toBe(b.touristTaxRappen);
    const [p] = await db().select().from(payments).where(eq(payments.bookingId, b.id));
    expect(p.status).toBe("partially_refunded");
  });

  it("Hotel storniert: immer volle Rückerstattung", async () => {
    const h = await stripeHotel();
    const b = await book(h, inDays(1), 2, 1); // Nicht stornierbar
    await send(event("checkout.session.completed", h.acct, completed(await sessionOf(b.id), b)));
    const r = await cancelBooking(b.id, { by: "hotel", actor: "user:test", hotelId: h.hotel.id });
    expect(r.refundRappen).toBe(b.totalRappen);
  });

  it("checkout.session.expired gibt den Hold frei", async () => {
    const h = await stripeHotel();
    const b = await book(h, inDays(34), 3);
    expect((await inv(h.rooms[0].roomType.id, b.checkin)).booked).toBe(1);
    await send(event("checkout.session.expired", h.acct, { id: await sessionOf(b.id), object: "checkout.session", payment_status: "unpaid", metadata: { booking_id: b.id } }));
    const [after] = await db().select().from(bookings).where(eq(bookings.id, b.id));
    expect(after.status).toBe("expired");
    for (let i = 0; i < 3; i++) expect((await inv(h.rooms[0].roomType.id, addDays(b.checkin, i))).booked).toBe(0);
    const [p] = await db().select().from(payments).where(eq(payments.bookingId, b.id));
    expect(p.status).toBe("failed");
  });

  it("Späte Zahlung: Zimmer noch frei → confirmed; Zimmer weg → volle Rückerstattung", async () => {
    const h = await stripeHotel();
    const b1 = await book(h, inDays(35));
    await expireHolds(new Date(Date.now() + 40 * 60_000));
    await send(event("checkout.session.completed", h.acct, completed(await sessionOf(b1.id), b1)));
    expect((await db().select().from(bookings).where(eq(bookings.id, b1.id)))[0].status).toBe("confirmed");
    expect((await inv(h.rooms[0].roomType.id, b1.checkin)).booked).toBe(1);

    const b2 = await book(h, inDays(40));
    await expireHolds(new Date(Date.now() + 40 * 60_000));
    await setBlocked(h.hotel.id, h.rooms[0].roomType.id, b2.checkin, b2.checkin, 3, { actor: "test" }); // alles gesperrt
    await send(event("checkout.session.completed", h.acct, completed(await sessionOf(b2.id), b2)));
    expect((await db().select().from(bookings).where(eq(bookings.id, b2.id)))[0].status).toBe("expired");
    expect(refunds.at(-1)!.params).toMatchObject({ amount: b2.totalRappen, refund_application_fee: true });
    expect((await inv(h.rooms[0].roomType.id, b2.checkin)).booked).toBe(0);
    expect((await inv(h.rooms[0].roomType.id, addDays(b2.checkin, 1))).booked).toBe(0);
    const mails = await db().select().from(emailOutbox).where(and(eq(emailOutbox.bookingId, b2.id), eq(emailOutbox.template, "late_payment_refunded")));
    expect(mails).toHaveLength(2);
  });

  it("account.updated setzt charges_enabled und TWINT-Status", async () => {
    const h = await stripeHotel({ twint: false });
    await db().update(hotels).set({ stripeChargesEnabled: false }).where(eq(hotels.id, h.hotel.id));
    await send(event("account.updated", h.acct, { id: h.acct, object: "account", charges_enabled: true, capabilities: { twint_payments: "active" } }));
    const [after] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
    expect(after).toMatchObject({ stripeChargesEnabled: true, stripeTwintActive: true });
  });

  it("Ereignisse werden in inbound_events protokolliert", async () => {
    const rows = await db().select().from(inboundEvents).where(eq(inboundEvents.source, "stripe"));
    expect(rows.length).toBeGreaterThan(5);
  });
});

describe("M2 Kalender", () => {
  it("Kalender-Änderung erzeugt Outbox-Einträge und audit_log", async () => {
    const h = await makeHotel();
    const rp = h.rooms[0].plans[0];
    const from = inDays(10);
    const to = addDays(from, 13);
    // nur Fr+Sa → zwei Bereiche pro Woche
    const n = await updateRates(h.hotel.id, rp.id, from, to, { priceRappen: 22000, minStayArrival: 2 }, { weekdays: [5, 6], actor: "user:test" });
    expect(n).toBe(4);
    const ob = await db().select().from(channexOutbox).where(and(eq(channexOutbox.hotelId, h.hotel.id), eq(channexOutbox.kind, "restrictions")));
    expect(ob).toHaveLength(2);
    expect(ob.every((o) => o.ratePlanId === rp.id && o.status === "pending")).toBe(true);
    const logs = await db().select().from(auditLog).where(and(eq(auditLog.hotelId, h.hotel.id), eq(auditLog.action, "rates.update")));
    expect(logs).toHaveLength(1);

    await setBlocked(h.hotel.id, h.rooms[0].roomType.id, from, addDays(from, 2), 1, { actor: "user:test" });
    expect((await inv(h.rooms[0].roomType.id, from)).blocked).toBe(1);
    const ob2 = await db().select().from(channexOutbox).where(and(eq(channexOutbox.hotelId, h.hotel.id), eq(channexOutbox.kind, "availability")));
    expect(ob2[0]).toMatchObject({ dateFrom: from, dateTo: addDays(from, 2) });
  });

  it("Kalender-Änderung an fremdem Hotel wird abgelehnt", async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    await expect(updateRates(a.hotel.id, b.rooms[0].plans[0].id, inDays(5), inDays(6), { priceRappen: 1000 }, { actor: "x" })).rejects.toThrow();
    await expect(setBlocked(a.hotel.id, b.rooms[0].roomType.id, inDays(5), inDays(6), 1, { actor: "x" })).rejects.toThrow();
  });
});
