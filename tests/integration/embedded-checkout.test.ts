import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { POST as createBookingRoute } from "../../app/api/bookings/route";
import { POST as v1Book } from "../../app/api/v1/bookings/route";
import { closeDb, db } from "../../src/db/client";
import { bookings, hotelModules, hotels } from "../../src/db/schema";
import { setStripeClient } from "../../src/integrations/stripe/client";
import { StripePaymentProvider } from "../../src/integrations/stripe/provider";
import { setPaymentProvider } from "../../src/payments/provider";
import { setEmbeddedCheckout } from "../../src/services/payment-settings";
import { createApiKey } from "../../src/services/posbridge";
import { addDays } from "../../src/domain/dates";
import { inDays, makeHotel } from "../helpers";

const stripe = new Stripe("sk_test_dummy");
const created: { params: Stripe.Checkout.SessionCreateParams; opts: Stripe.RequestOptions }[] = [];

beforeAll(() => {
  process.env.PAYMENT_PROVIDER = "stripe";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_embedded";
  stripe.checkout.sessions.create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams, opts: Stripe.RequestOptions) => {
    created.push({ params, opts });
    const emb = (params as { ui_mode?: string }).ui_mode === "embedded_page";
    return { id: `cs_test_${created.length}_${Date.now()}`, url: emb ? null : "https://checkout.stripe.com/c/pay/test", client_secret: emb ? "cs_secret_abc" : null };
  }) as never;
  setStripeClient(stripe);
  setPaymentProvider(new StripePaymentProvider());
});
afterAll(async () => { setStripeClient(null); setPaymentProvider(null); process.env.PAYMENT_PROVIDER = "fake"; await closeDb(); });

async function stripeHotel() {
  const h = await makeHotel();
  const acct = `acct_${h.hotel.slug.replace(/-/g, "")}`;
  await db().update(hotels).set({ stripeAccountId: acct, stripeChargesEnabled: true, stripeTwintActive: true }).where(eq(hotels.id, h.hotel.id));
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  return { ...h, hotel, acct };
}
const payload = (h: Awaited<ReturnType<typeof stripeHotel>>, ci: string) => ({ room_type_id: h.rooms[0].roomType.id, rate_plan_id: h.rooms[0].plans[0].id, checkin: ci, checkout: addDays(ci, 2), adults: 2, children: 0, guest: { first_name: "Max", last_name: "Gast", email: "max@example.ch", language: "de" }, terms_accepted: true });
let ip = 0;
const web = (h: Awaited<ReturnType<typeof stripeHotel>>, ci: string) => createBookingRoute(new Request("http://x/api/bookings", { method: "POST", headers: { host: h.hotel.primaryDomain!, "content-type": "application/json", "x-forwarded-for": `10.77.${ip++}.1` }, body: JSON.stringify(payload(h, ci)) }));

describe("Stripe Checkout eingebettet (SPEC 19.25)", () => {
  it("Einstellung aus: Weiterleitung wie bisher (success_url/cancel_url, keine ui_mode)", async () => {
    created.length = 0;
    const h = await stripeHotel();
    const r = await web(h, inDays(30));
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j.checkout_url).toContain("stripe.com");
    expect(j.client_secret).toBeUndefined();
    expect(created[0].params).toMatchObject({ success_url: expect.any(String), cancel_url: expect.any(String) });
    expect((created[0].params as { ui_mode?: string }).ui_mode).toBeUndefined();
  });

  it("Einstellung an: ui_mode embedded_page mit return_url, Konto des Hotels, client_secret zurück, keine success_url", async () => {
    created.length = 0;
    const h = await stripeHotel();
    await setEmbeddedCheckout(h.hotel, true, "test");
    const r = await web(h, inDays(40));
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j).toMatchObject({ client_secret: "cs_secret_abc", stripe_account: h.acct, publishable_key: "pk_test_embedded" });
    expect(j.checkout_url).toBeUndefined();
    const p = created[0].params as Record<string, unknown>;
    expect(p.ui_mode).toBe("embedded_page");
    expect((p as { adaptive_pricing?: { enabled?: boolean } }).adaptive_pricing).toEqual({ enabled: false }); // keine Umrechnung in Gast-Währung
    expect(String(p.return_url)).toContain("/b/");
    expect(p.success_url).toBeUndefined();
    expect(p.cancel_url).toBeUndefined();
    expect(created[0].opts.stripeAccount).toBe(h.acct);
    const [b] = await db().select().from(bookings).where(eq(bookings.hotelId, h.hotel.id));
    expect(b.status).toBe("hold"); // bestätigt wird weiterhin nur durch den Webhook
  });

  it("API v1: embedded=true liefert client_secret statt checkout_url, return_url bleibt die der Agentur", async () => {
    created.length = 0;
    const h = await stripeHotel();
    await db().insert(hotelModules).values({ hotelId: h.hotel.id, module: "api", enabled: true });
    const { key } = await createApiKey(h.hotel.id, "Agentur", "t", "website");
    const res = await v1Book(new Request("http://x/api/v1/bookings", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ ...payload(h, inDays(50)), embedded: true }) }));
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j).toMatchObject({ checkout_url: null, client_secret: "cs_secret_abc", stripe_account: h.acct });
    expect((created[0].params as { ui_mode?: string }).ui_mode).toBe("embedded_page");
  });
});
