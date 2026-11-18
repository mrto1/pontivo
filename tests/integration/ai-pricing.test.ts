import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { aiPricingRuns, auditLog, hotelModules, hotels, ratesDays } from "../../src/db/schema";
import { AiPricingError, refreshProposals, runAiPricing, runsToday, type FetchLike } from "../../src/services/ai-pricing";
import { applyProposals, listProposals, saveRule, type RuleInput } from "../../src/services/pricing-rules";
import { applyModules } from "../../src/services/modules";
import { inDays, makeHotel } from "../helpers";

afterAll(closeDb);
beforeEach(() => { process.env.ANTHROPIC_API_KEY = "test-key"; });
afterEach(() => { delete process.env.ANTHROPIC_API_KEY; delete process.env.AI_PRICING_RUNS_PER_DAY; });

const rule = (over: Partial<RuleInput> = {}): RuleInput => ({ baseRappen: 20000, minRappen: 15000, maxRappen: 30000, occupancySteps: [], lastMinute: null, weekdayBps: [0, 0, 0, 0, 0, 0, 0], autoApply: false, active: true, ...over });
const fresh = async (id: string) => (await db().select().from(hotels).where(eq(hotels.id, id)))[0];
const price = async (planId: string, night: string) => (await db().select().from(ratesDays).where(and(eq(ratesDays.ratePlanId, planId), eq(ratesDays.night, night))))[0].priceRappen;
const answer = (text: string, status = 200): FetchLike => async () => ({ status, text: async () => JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 1200, output_tokens: 300 } }) });

async function setup(over: Partial<RuleInput> = {}) {
  const h = await makeHotel();
  await saveRule(h.hotel.id, h.rooms[0].plans[0].id, rule(over), "t");
  await applyModules(h.hotel.id, { pricing_rules: true, ai_pricing: true }, "t");
  return { hotel: await fresh(h.hotel.id), plan: h.rooms[0].plans[0].id };
}

describe("KI-Preisempfehlung (Modul ai_pricing)", () => {
  it("Modul braucht die Regeln: Einschalten zieht pricing_rules mit; ohne Modul oder Schlüssel läuft nichts", async () => {
    const h = await makeHotel();
    const changed = await applyModules(h.hotel.id, { ai_pricing: true }, "t");
    expect(changed).toEqual({ ai_pricing: true, pricing_rules: true });
    delete process.env.ANTHROPIC_API_KEY;
    await expect(runAiPricing(await fresh(h.hotel.id), "t", { fetcher: answer("[]") })).rejects.toThrow(AiPricingError);
  });

  it("schlägt vor (Quelle KI), hält den Korridor, ändert den Preis nicht ohne Bestätigung; Übernahme schreibt ihn", async () => {
    const { hotel, plan } = await setup();
    const n1 = inDays(10), n2 = inDays(11);
    const before = await price(plan, n1);
    const r = await runAiPricing(hotel, "t", { fetcher: answer(`[{"night":"${n1}","price_chf":250,"reason":"Auslastung 80 %, Pickup 2"},{"night":"${n2}","price_chf":900,"reason":"Ausreisser"},{"night":"2020-01-01","price_chf":200,"reason":"unbekannt"}]`) });
    expect(r).toMatchObject({ proposed: 2, applied: 0, rejected: 1 });
    expect(await price(plan, n1)).toBe(before);
    const open = await listProposals(hotel.id, inDays(0));
    const p1 = open.find((x) => x.night === n1)!, p2 = open.find((x) => x.night === n2)!;
    expect(p1).toMatchObject({ source: "ai", proposedRappen: 25000 });
    expect(p1.reason).toContain("KI: Auslastung 80 %");
    expect(p2.proposedRappen).toBe(30000); // auf Höchstpreis begrenzt
    expect(await applyProposals(hotel.id, [p1.id], "martin")).toBe(1);
    expect(await price(plan, n1)).toBe(25000);
    const runs = await db().select().from(aiPricingRuns).where(eq(aiPricingRuns.hotelId, hotel.id));
    expect(runs).toMatchObject([{ status: "ok", proposals: 2, rejected: 1, inputTokens: 1200, outputTokens: 300 }]);
    expect((await db().select().from(auditLog).where(and(eq(auditLog.hotelId, hotel.id), eq(auditLog.action, "pricing.ai_run")))).length).toBe(1);
  });

  it("Automatik nur wenn die Regel sie erlaubt, und nur im Korridor", async () => {
    const { hotel, plan } = await setup({ autoApply: true });
    const n = inDays(12);
    const r = await runAiPricing(hotel, "t", { fetcher: answer(`[{"night":"${n}","price_chf":999,"reason":"viel Nachfrage"}]`) });
    expect(r.applied).toBe(1);
    expect(await price(plan, n)).toBe(30000); // nie über dem Höchstpreis
  });

  it("Fehler der KI: Regel-Vorschläge bleiben, Lauf wird als Fehler protokolliert, Tageslimit gilt", async () => {
    process.env.AI_PRICING_RUNS_PER_DAY = "2";
    const { hotel } = await setup({ occupancySteps: [{ fromPct: 0, bps: 2000 }] });
    const res = await refreshProposals(hotel, "t", { fetcher: answer("down", 503) });
    expect(res.proposed).toBeGreaterThan(0); // nach Regeln
    expect(res).toMatchObject({ ai: null, aiError: expect.stringContaining("nicht erreichbar") });
    expect((await listProposals(hotel.id, inDays(0))).every((p) => p.source === "rules")).toBe(true);
    await refreshProposals(hotel, "t", { fetcher: answer("kein json") }); // zweiter Lauf, ohne brauchbare Antwort
    expect(await runsToday(hotel.id, inDays(0))).toBe(2);
    await expect(runAiPricing(hotel, "t", { fetcher: answer("[]") })).rejects.toThrow(/verbraucht/);
  });

  it("Mandantentrennung: Regeln und Vorschläge eines anderen Betriebs bleiben unberührt", async () => {
    const a = await setup(), b = await setup();
    await runAiPricing(a.hotel, "t", { fetcher: answer(`[{"night":"${inDays(10)}","price_chf":250,"reason":"x"}]`) });
    expect(await listProposals(b.hotel.id, inDays(0))).toHaveLength(0);
    const on = await db().select().from(hotelModules).where(and(eq(hotelModules.hotelId, b.hotel.id), eq(hotelModules.module, "ai_pricing")));
    expect(on[0].enabled).toBe(true);
  });
});
