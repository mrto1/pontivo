import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import Stripe from "stripe";
import { POST as stripeWebhook } from "../../app/api/webhooks/stripe/route";
import { POST as createBookingRoute } from "../../app/api/bookings/route";
import { db, closeDb } from "../../src/db/client";
import { bookings, emailOutbox, hotels, payments, ratePlans } from "../../src/db/schema";
import { setStripeClient } from "../../src/integrations/stripe/client";
import { StripePaymentProvider } from "../../src/integrations/stripe/provider";
import { setPaymentProvider } from "../../src/payments/provider";
import { cancelBooking } from "../../src/services/bookings";
import { balanceJob, markBalanceOnsite, startBalancePayment } from "../../src/services/balance";
import { addDays, todayIn } from "../../src/domain/dates";
import { feeShare } from "../../src/domain/deposit";
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
async function setup(depositBps = 3000) {
  const h = await makeHotel();
  const acct = `acct_${h.hotel.slug.replace(/-/g, "")}`;
  await db().update(hotels).set({ stripeAccountId: acct, stripeChargesEnabled: true, stripeTwintActive: true, depositBps, balanceDueDays: 7 }).where(eq(hotels.id, h.hotel.id));
  return { ...h, acct };
}
type H = Awaited<ReturnType<typeof setup>>;

async function book(h: H, checkin: string, nights = 2) {
  const res = await createBookingRoute(new Request("http://x/api/bookings", {
    method: "POST",
    headers: { host: h.hotel.primaryDomain!, "content-type": "application/json", "x-forwarded-for": `10.60.${ip++}.1` },
    body: JSON.stringify({ room_type_id: h.rooms[0].roomType.id, rate_plan_id: h.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, nights), adults: 2, children: 0,
      guest: { first_name: "Max", last_name: "Gast", email: "max@example.ch", language: "de" }, terms_accepted: true }),
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

/** Buchung mit Anzahlung, Anzahlung per Webhook bezahlt */
async function confirmedDeposit(h: H, checkin = inDays(40)) {
  const b = await book(h, checkin);
  const [p] = await pays(b.id);
  const dep = b.totalRappen - b.balanceRappen;
  await send(evt("checkout.session.completed", h.acct, session(p.stripeCheckoutSessionId!, b, dep, `pi_dep_${b.id.slice(0, 8)}`)));
  return { b: await get(b.id), dep };
}

describe("Anzahlung bei der Buchung", () => {
  it("30 %: Stripe bekommt nur die Anzahlung und anteilige Gebühr; bestätigt, Rest bleibt offen", async () => {
    const h = await setup();
    const b = await book(h, inDays(40));
    expect(b.balanceRappen).toBe(b.totalRappen - Math.floor((b.totalRappen * 3000 + 5000) / 10000));
    expect(b.balanceDueOn).toBe(addDays(b.checkin, -7));
    const dep = b.totalRappen - b.balanceRappen;
    const { params } = created[0];
    expect(params.line_items?.[0].price_data?.unit_amount).toBe(dep);
    expect(params.payment_intent_data?.application_fee_amount).toBe(feeShare(b.platformFeeRappen, b.totalRappen, dep));
    const [p] = await pays(b.id);
    expect(p).toMatchObject({ kind: "deposit", amountRappen: dep, status: "pending" });

    const { b: after } = await confirmedDeposit(h, inDays(41));
    expect(after.status).toBe("confirmed");
    expect(after.balancePaidAt).toBeNull();
    const [dp] = await pays(after.id);
    expect(dp).toMatchObject({ kind: "deposit", status: "succeeded" });
  });

  it("Anreise zu nah oder Anzahlung aus: wie bisher volle Zahlung", async () => {
    const h = await setup();
    const near = await book(h, inDays(5));
    expect(near.balanceRappen).toBe(0);
    expect(created[0].params.line_items?.[0].price_data?.unit_amount).toBe(near.totalRappen);
    expect((await pays(near.id))[0].kind).toBe("full");
    const off = await setup(10000);
    const full = await book(off, inDays(60));
    expect(full.balanceRappen).toBe(0);
  });
});

describe("Restzahlung", () => {
  it("Aufforderung am Fälligkeitstag, Erinnerung nach 3 Tagen, Hinweis ans Hotel; jede Stufe nur einmal", async () => {
    const h = await setup();
    const { b } = await confirmedDeposit(h, inDays(40));
    const tz = h.hotel.timezone;
    // Der Job läuft über alle Buchungen der Datenbank, darum zählen wir die Mails dieser einen Buchung
    await balanceJob(new Date(`${addDays(b.balanceDueOn!, -1)}T12:00:00Z`));
    expect(await mails(b.id, "balance_due")).toBe(0);
    const due = new Date(`${b.balanceDueOn}T12:00:00Z`);
    await balanceJob(due);
    await balanceJob(due);
    expect(await mails(b.id, "balance_due")).toBe(1);
    expect(await mails(b.id, "balance_reminder")).toBe(0);
    const rem = new Date(due.getTime() + 3 * 86400_000);
    expect(todayIn(tz, rem) < b.checkin).toBe(true);
    await balanceJob(rem);
    await balanceJob(rem);
    expect(await mails(b.id, "balance_reminder")).toBe(1);
    expect(await mails(b.id, "hotel_balance_open")).toBe(0);
    const late = new Date(`${addDays(b.checkin, -2)}T12:00:00Z`);
    await balanceJob(late);
    await balanceJob(late);
    expect(await mails(b.id, "hotel_balance_open")).toBe(1);
    expect(await mails(b.id, "balance_due")).toBe(1);
  });

  it("Zahlungslink: frische Sitzung für den Rest mit Restgebühr; nach Webhook bezahlt, Buchung bleibt bestätigt; doppelte Meldung ändert nichts", async () => {
    const h = await setup();
    const { b, dep } = await confirmedDeposit(h);
    created.length = 0;
    const { url } = await startBalancePayment(b.publicToken);
    expect(url).toContain("checkout.stripe.com");
    const { params, opts } = created[0];
    expect(opts.stripeAccount).toBe(h.acct);
    expect(params.line_items?.[0].price_data?.unit_amount).toBe(b.balanceRappen);
    expect(params.metadata).toMatchObject({ booking_id: b.id, kind: "balance" });
    const depFee = feeShare(b.platformFeeRappen, b.totalRappen, dep);
    expect(params.payment_intent_data?.application_fee_amount).toBe(b.platformFeeRappen - depFee); // Anzahlung + Rest = Gesamtgebühr
    const bal = (await pays(b.id)).find((p) => p.kind === "balance")!;
    expect(bal.status).toBe("pending");

    const s = session(bal.stripeCheckoutSessionId!, b, b.balanceRappen, "pi_bal_1", "balance");
    expect((await send(evt("checkout.session.completed", h.acct, s))).status).toBe(200);
    expect((await send(evt("checkout.session.completed", h.acct, s))).status).toBe(200); // zweites Ereignis
    const after = await get(b.id);
    expect(after.status).toBe("confirmed");
    expect(after.balancePaidAt).not.toBeNull();
    expect(await mails(b.id, "balance_paid")).toBe(1);
    expect((await pays(b.id)).filter((p) => p.kind === "balance" && p.status === "succeeded")).toHaveLength(1);
    // nichts mehr offen
    await expect(startBalancePayment(b.publicToken)).rejects.toThrow(/no_balance_open/);
    expect(refunds).toHaveLength(0);
  });

  it("abgelaufener oder gescheiterter Zahlungslink für den Rest gibt die Buchung nicht frei", async () => {
    const h = await setup();
    const { b } = await confirmedDeposit(h);
    await startBalancePayment(b.publicToken);
    const bal = (await pays(b.id)).find((p) => p.kind === "balance")!;
    const s = { ...session(bal.stripeCheckoutSessionId!, b, b.balanceRappen, "pi_x", "balance"), payment_status: "unpaid" };
    expect((await send(evt("checkout.session.expired", h.acct, s))).status).toBe(200);
    expect((await send(evt("checkout.session.async_payment_failed", h.acct, s))).status).toBe(200);
    expect((await get(b.id)).status).toBe("confirmed");
    expect((await pays(b.id)).find((p) => p.kind === "deposit")!.status).toBe("succeeded");
  });

  it("Hotel markiert «vor Ort erhalten»: keine Zahlungsaufforderung mehr, Mails storniert", async () => {
    const h = await setup();
    const { b } = await confirmedDeposit(h);
    await balanceJob(new Date(`${b.balanceDueOn}T12:00:00Z`));
    expect(await mails(b.id, "balance_due")).toBe(1);
    await markBalanceOnsite(h.hotel.id, b.id, "t");
    expect((await get(b.id)).balanceOnsiteAt).not.toBeNull();
    await expect(startBalancePayment(b.publicToken)).rejects.toThrow();
    await expect(markBalanceOnsite((await setup()).hotel.id, b.id, "t")).rejects.toThrow(/not_found/); // fremdes Hotel
    const all = await db().select().from(emailOutbox).where(and(eq(emailOutbox.bookingId, b.id), eq(emailOutbox.template, "balance_due")));
    expect(all[0].status).toBe("cancelled");
    await balanceJob(new Date(`${addDays(b.checkin, -1)}T12:00:00Z`));
    expect(await mails(b.id, "balance_reminder")).toBe(0);
    expect(await mails(b.id, "hotel_balance_open")).toBe(0);
  });

  it("Restzahlung trifft nach der Stornierung ein: wird sofort zurückerstattet", async () => {
    const h = await setup();
    const { b } = await confirmedDeposit(h);
    await startBalancePayment(b.publicToken);
    const bal = (await pays(b.id)).find((p) => p.kind === "balance")!;
    await cancelBooking(b.id, { by: "hotel", actor: "t", hotelId: h.hotel.id });
    refunds.length = 0;
    await send(evt("checkout.session.completed", h.acct, session(bal.stripeCheckoutSessionId!, b, b.balanceRappen, "pi_late", "balance")));
    expect(refunds).toHaveLength(1);
    expect(refunds[0].params).toMatchObject({ payment_intent: "pi_late", amount: b.balanceRappen });
    expect((await get(b.id)).balancePaidAt).toBeNull();
  });
});

describe("Storno mit Anzahlung", () => {
  const setPlan = (h: H, v: { freeCancelHours: number | null; cancelFeeBps: number }) => db().update(ratePlans).set(v).where(eq(ratePlans.id, h.rooms[0].plans[0].id));

  it("kostenlos, nur Anzahlung bezahlt: genau die Anzahlung zurück", async () => {
    const h = await setup();
    await setPlan(h, { freeCancelHours: 24, cancelFeeBps: 10000 });
    const { b, dep } = await confirmedDeposit(h);
    const r = await cancelBooking(b.id, { by: "guest", actor: "guest" });
    expect(r).toMatchObject({ refundRappen: dep, feeOpenRappen: 0 });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].params.amount).toBe(dep);
  });

  it("kostenlos, Anzahlung und Rest bezahlt: beide erstattet, neueste Zahlung zuerst, verschiedene Schlüssel", async () => {
    const h = await setup();
    await setPlan(h, { freeCancelHours: 24, cancelFeeBps: 10000 });
    const { b, dep } = await confirmedDeposit(h);
    await startBalancePayment(b.publicToken);
    const bal = (await pays(b.id)).find((p) => p.kind === "balance")!;
    await send(evt("checkout.session.completed", h.acct, session(bal.stripeCheckoutSessionId!, b, b.balanceRappen, "pi_bal", "balance")));
    refunds.length = 0;
    const r = await cancelBooking(b.id, { by: "guest", actor: "guest" });
    expect(r.refundRappen).toBe(b.totalRappen);
    expect(refunds.map((x) => x.params.amount).sort()).toEqual([dep, b.balanceRappen].sort());
    expect(new Set(refunds.map((x) => x.opts.idempotencyKey)).size).toBe(2);
    const all = await pays(b.id);
    expect(all.every((p) => p.status === "refunded")).toBe(true);
  });

  it("Gebühr grösser als das Bezahlte: nichts zurück, offener Gebührenrest wird gemeldet", async () => {
    const h = await setup();
    await setPlan(h, { freeCancelHours: null, cancelFeeBps: 10000 });
    const { b, dep } = await confirmedDeposit(h);
    const r = await cancelBooking(b.id, { by: "guest", actor: "guest" });
    expect(refunds).toHaveLength(0);
    expect(r.refundRappen).toBe(0);
    expect(r.feeOpenRappen).toBe(b.roomsTotalRappen - dep > 0 ? b.roomsTotalRappen - dep : 0);
    expect((await get(b.id)).status).toBe("cancelled");
  });

  it("Gebühr kleiner als das Bezahlte: nur der Überschuss zurück", async () => {
    const h = await setup(6000);
    await setPlan(h, { freeCancelHours: null, cancelFeeBps: 2000 });
    const { b, dep } = await confirmedDeposit(h);
    const fee = Math.floor((b.roomsTotalRappen * 2000 + 5000) / 10000);
    const r = await cancelBooking(b.id, { by: "guest", actor: "guest" });
    expect(r.feeRappen).toBe(fee);
    expect(r.refundRappen).toBe(Math.max(0, dep - fee));
    expect(r.feeOpenRappen).toBe(Math.max(0, fee - dep));
  });
});
