import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { auditLog, hotels } from "../../src/db/schema";
import { setStripeClient, type Stripe } from "../../src/integrations/stripe/client";
import { domainSummary, hotelDomains, methodStates, registerDomains, setMethods } from "../../src/integrations/stripe/payment-methods";
import { makeHotel } from "../helpers";

afterAll(async () => { setStripeClient(null); await closeDb(); });

type Dom = { id: string; domain_name: string; enabled: boolean; apple_pay: { status: string }; google_pay: { status: string } };
let domains: Dom[] = [];
let calls: { fn: string; args: unknown[] }[] = [];
let cfg: Record<string, { available: boolean; display_preference: { preference: string; value: string } }>;
let failDomain: string | null = null;

beforeEach(() => {
  domains = []; calls = []; failDomain = null;
  cfg = {
    apple_pay: { available: true, display_preference: { preference: "on", value: "on" } },
    google_pay: { available: true, display_preference: { preference: "on", value: "on" } },
    twint: { available: false, display_preference: { preference: "off", value: "off" } },
  };
  setStripeClient({
    accounts: { retrieveCurrent: async () => ({ id: "acct_platform" }) },
    paymentMethodConfigurations: {
      list: async (p: unknown, o: unknown) => { calls.push({ fn: "pmc.list", args: [p, o] }); return { data: [{ id: "pmc_other", is_default: false }, { id: "pmc_1", is_default: true, ...cfg }] }; },
      update: async (id: string, p: Record<string, { display_preference: { preference: string } }>, o: unknown) => { calls.push({ fn: "pmc.update", args: [id, p, o] }); for (const [k, v] of Object.entries(p)) cfg[k].display_preference = { preference: v.display_preference.preference, value: v.display_preference.preference }; return {}; },
    },
    paymentMethodDomains: {
      list: async (p: { domain_name: string }, o: unknown) => { calls.push({ fn: "pmd.list", args: [p, o] }); return { data: domains.filter((d) => d.domain_name === p.domain_name) }; },
      create: async (p: { domain_name: string }, o: unknown) => {
        calls.push({ fn: "pmd.create", args: [p, o] });
        if (p.domain_name === failDomain) throw new Error("domain_invalid");
        const d = { id: `pmd_${domains.length + 1}`, domain_name: p.domain_name, enabled: true, apple_pay: { status: "inactive" }, google_pay: { status: "active" } };
        domains.push(d); return d;
      },
      update: async (id: string, p: { enabled: boolean }, o: unknown) => { calls.push({ fn: "pmd.update", args: [id, p, o] }); const d = domains.find((x) => x.id === id)!; d.enabled = p.enabled; return d; },
      validate: async (id: string, _p: unknown, o: unknown) => { calls.push({ fn: "pmd.validate", args: [id, o] }); const d = domains.find((x) => x.id === id)!; d.apple_pay.status = "active"; return d; },
    },
  } as unknown as Stripe);
});

async function mk(primaryDomain: string | null) {
  const h = await makeHotel();
  await db().update(hotels).set({ stripeAccountId: `acct_${h.hotel.slug.replace(/-/g, "")}`, primaryDomain }).where(eq(hotels.id, h.hotel.id));
  return (await db().select().from(hotels).where(eq(hotels.id, h.hotel.id)))[0];
}

describe("Zahlarten und Domains im Stripe-Konto des Hotels (SPEC 19.52)", () => {
  it("Domains: eigene Domain und Pontivo-Adresse, nie localhost oder ohne Punkt", () => {
    expect(hotelDomains({ primaryDomain: "www.hotel-test.ch" })).toContain("www.hotel-test.ch");
    expect(hotelDomains({ primaryDomain: "localhost" })).not.toContain("localhost");
    expect(hotelDomains({ primaryDomain: null }).every((d) => d.includes("."))).toBe(true);
  });

  it("Stand lesen: nimmt die Standardkonfiguration des Hotelkontos", async () => {
    const h = await mk("a.hotel-test.ch");
    const m = await methodStates(h);
    expect(m.find((x) => x.key === "twint")).toMatchObject({ value: "off", available: false });
    expect(m.find((x) => x.key === "apple_pay")).toMatchObject({ value: "on", available: true });
    expect(calls[0]).toMatchObject({ fn: "pmc.list", args: [{ application: "acct_platform" }, { stripeAccount: h.stripeAccountId }] });
  });

  it("Schalten: sendet nur Änderungen, im Konto des Hotels, mit Audit", async () => {
    const h = await mk("b.hotel-test.ch");
    await setMethods(h, { apple_pay: true, google_pay: false, twint: true }, "user:t");
    const up = calls.find((c) => c.fn === "pmc.update")!;
    expect(up.args[0]).toBe("pmc_1");
    expect(up.args[1]).toEqual({ google_pay: { display_preference: { preference: "off" } }, twint: { display_preference: { preference: "on" } } });
    expect(up.args[2]).toEqual({ stripeAccount: h.stripeAccountId });
    const a = await db().select().from(auditLog).where(eq(auditLog.hotelId, h.id));
    expect(a.some((x) => x.action === "stripe.payment_methods")).toBe(true);
    calls.length = 0;
    await setMethods(h, { apple_pay: true, google_pay: false, twint: true }, "user:t");
    expect(calls.some((c) => c.fn === "pmc.update")).toBe(false); // nichts zu ändern
  });

  it("Domains eintragen: anlegen, prüfen, im Konto des Hotels; zweiter Lauf legt nichts doppelt an", async () => {
    const h = await mk("c.hotel-test.ch");
    const r = await registerDomains(h, "user:t");
    const mine = r.find((x) => x.domain === "c.hotel-test.ch")!;
    expect(mine).toMatchObject({ enabled: true, apple: "active", google: "active" });
    const create = calls.find((c) => c.fn === "pmd.create")!;
    expect(create.args[1]).toEqual({ stripeAccount: h.stripeAccountId });
    const n = calls.filter((c) => c.fn === "pmd.create").length;
    await registerDomains(h, "user:t");
    expect(calls.filter((c) => c.fn === "pmd.create").length).toBe(n);
  });

  it("ausgeschaltete Domain wird wieder eingeschaltet", async () => {
    const h = await mk("d.hotel-test.ch");
    domains.push({ id: "pmd_x", domain_name: "d.hotel-test.ch", enabled: false, apple_pay: { status: "active" }, google_pay: { status: "active" } });
    await registerDomains(h, "user:t");
    expect(domains[0].enabled).toBe(true);
  });

  it("Fehler bei einer Domain bricht die anderen nicht ab und wird gemeldet", async () => {
    const h = await mk("e.hotel-test.ch");
    failDomain = "e.hotel-test.ch";
    const r = await registerDomains(h, "user:t");
    expect(r.find((x) => x.domain === "e.hotel-test.ch")).toMatchObject({ error: "domain_invalid" });
    expect(domainSummary(r)).toContain("fehlgeschlagen");
  });

  it("ohne Stripe-Konto: klare Fehlermeldung", async () => {
    const h = await mk(null);
    await db().update(hotels).set({ stripeAccountId: null }).where(eq(hotels.id, h.id));
    const [fresh] = await db().select().from(hotels).where(eq(hotels.id, h.id));
    await expect(registerDomains(fresh, "t")).rejects.toThrow(/Stripe-Konto/);
    await expect(methodStates(fresh)).rejects.toThrow(/Stripe-Konto/);
  });
});
