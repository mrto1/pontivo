import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { aiPricingRuns, inventoryDays, pricingEvents, pricingProposals, ratePlans, ratesDays, hotels, hotelModules, type Hotel } from "../db/schema";
import { AI_SYSTEM, buildUserPrompt, parseAiAnswer, type AiNight } from "../domain/ai-pricing";
import { addDays, diffDays, todayIn, weekday } from "../domain/dates";
import { proposePrice, type Rule } from "../domain/pricing-rules";
import { env } from "../env";
import { audit } from "./audit";
import { moduleOn } from "./modules";
import { applyProposals, generateProposals, listRules } from "./pricing-rules";

/**
 * KI-Preisempfehlung (Modul ai_pricing). Baut auf den Regeln auf: gleicher Preiskorridor, gleiche Vorschlagsliste.
 * Die KI liefert nur Vorschläge (source = 'ai'); übernommen wird nur nach Bestätigung oder, wenn das Hotel bei der Regel
 * «automatisch übernehmen» eingeschaltet hat, und dann nur im Korridor (applyProposals prüft ihn erneut).
 * ASSUMPTION: Gebühr offen (QUESTIONS.md), daher nur technische Obergrenze je Hotel und Tag; keine Wettbewerbsdaten.
 */
export class AiPricingError extends Error {}
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text: () => Promise<string> }>;
const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const DAYS = 90;

export const aiPricingActive = async (hotelId: string) => !!env().ANTHROPIC_API_KEY && (await moduleOn(hotelId, "ai_pricing"));

export async function runsToday(hotelId: string, day: string): Promise<number> {
  const [r] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM ai_pricing_runs WHERE hotel_id = ${hotelId} AND day = ${day}::date`));
  return r.n;
}

async function callModel(system: string, user: string, fetcher: FetchLike): Promise<{ text: string; input: number; output: number }> {
  const key = env().ANTHROPIC_API_KEY;
  if (!key) throw new AiPricingError("Kein API-Schlüssel hinterlegt.");
  const res = await fetcher("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env().PRICING_MODEL, max_tokens: 8000, temperature: 0.2, system, messages: [{ role: "user", content: user }] }),
  });
  const body = await res.text();
  if (res.status < 200 || res.status >= 300) throw new AiPricingError(`Die KI ist gerade nicht erreichbar (HTTP ${res.status}).`);
  const j = JSON.parse(body) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
  if (!text) throw new AiPricingError("Die KI hat nicht geantwortet.");
  return { text, input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0 };
}

/**
 * KI-Vorschläge für alle aktiven Regeln des Hotels. Ersetzt offene Vorschläge nur für die Nächte, zu denen die KI etwas sagt.
 * Bei Fehlern bleiben die regelbasierten Vorschläge bestehen.
 */
export async function runAiPricing(hotel: Hotel, actor: string, opts: { fetcher?: FetchLike; now?: Date } = {}): Promise<{ proposed: number; applied: number; rejected: number }> {
  const now = opts.now ?? new Date();
  const today = todayIn(hotel.timezone, now);
  if (!(await aiPricingActive(hotel.id))) throw new AiPricingError("Die KI-Preisempfehlung ist nicht eingeschaltet.");
  const cap = env().AI_PRICING_RUNS_PER_DAY;
  if ((await runsToday(hotel.id, today)) >= cap) throw new AiPricingError(`Für heute sind alle ${cap} KI-Berechnungen verbraucht. Morgen geht es weiter.`);
  const fetcher: FetchLike = opts.fetcher ?? ((u, i) => fetch(u, i));
  const rules = (await listRules(hotel.id)).filter((r) => r.active);
  if (!rules.length) throw new AiPricingError("Zuerst bei einem Tarif eine Regel mit Preiskorridor speichern.");
  const to = addDays(today, DAYS - 1);
  const events = await db().select().from(pricingEvents).where(and(eq(pricingEvents.hotelId, hotel.id), lte(pricingEvents.fromDay, to), gte(pricingEvents.toDay, today)));
  const tot = { proposed: 0, applied: 0, rejected: 0, nights: 0, input: 0, output: 0 };
  try {
    for (const rule of rules) {
      const [plan] = await db().select().from(ratePlans).where(and(eq(ratePlans.id, rule.ratePlanId), eq(ratePlans.hotelId, hotel.id)));
      if (!plan || !plan.active) continue;
      const inv = new Map((await db().select().from(inventoryDays).where(and(eq(inventoryDays.hotelId, hotel.id), eq(inventoryDays.roomTypeId, plan.roomTypeId), gte(inventoryDays.night, addDays(today, -364), ), lte(inventoryDays.night, to)))).map((i) => [i.night, i]));
      const rates = await db().select().from(ratesDays).where(and(eq(ratesDays.hotelId, hotel.id), eq(ratesDays.ratePlanId, plan.id), gte(ratesDays.night, today), lte(ratesDays.night, to)));
      const pickup = new Map(rows<{ night: string; n: number }>(await db().execute(sql`
        SELECT to_char(g.n, 'YYYY-MM-DD') AS night, count(*)::int AS n
          FROM bookings b JOIN booking_rooms br ON br.booking_id = b.id
          CROSS JOIN LATERAL generate_series(b.checkin, b.checkout - 1, interval '1 day') AS g(n)
         WHERE b.hotel_id = ${hotel.id} AND br.room_type_id = ${plan.roomTypeId} AND b.status = 'confirmed'
           AND b.confirmed_at >= ${new Date(now.getTime() - 7 * 86_400_000).toISOString()}::timestamptz
           AND g.n >= ${today}::date AND g.n <= ${to}::date
         GROUP BY g.n`)).map((r) => [r.night, r.n]));
      const toRule: Rule = { baseRappen: rule.baseRappen, minRappen: rule.minRappen, maxRappen: rule.maxRappen, occupancySteps: rule.occupancySteps, lastMinute: rule.lastMinute, weekdayBps: rule.weekdayBps };
      const nights: AiNight[] = [];
      for (const r of rates) {
        const i = inv.get(r.night);
        if (!i || r.stopSell) continue;
        const sellable = i.total - i.blocked - i.externalBlocked;
        if (sellable <= 0) continue;
        const occ = (i.booked / sellable) * 100;
        const ev = events.filter((e) => e.fromDay <= r.night && e.toDay >= r.night);
        const ruleRes = proposePrice(toRule, { occupancyPct: occ, leadDays: diffDays(today, r.night), weekday: weekday(r.night), events: ev.map((e) => ({ name: e.name, bps: e.adjustBps })) });
        const ly = inv.get(addDays(r.night, -364));
        const lySell = ly ? ly.total - ly.blocked - ly.externalBlocked : 0;
        nights.push({ night: r.night, weekday: WEEKDAYS[weekday(r.night)], leadDays: diffDays(today, r.night), occupancyPct: occ, pickup7: pickup.get(r.night) ?? 0,
          lastYearPct: ly && lySell > 0 ? (ly.booked / lySell) * 100 : null, currentRappen: r.priceRappen, ruleRappen: ruleRes.priceRappen, events: ev.map((e) => e.name) });
      }
      if (!nights.length) continue;
      tot.nights += nights.length;
      const corridor = { minRappen: rule.minRappen, maxRappen: rule.maxRappen, baseRappen: rule.baseRappen };
      const ans = await callModel(AI_SYSTEM, buildUserPrompt(plan.name, corridor, nights), fetcher);
      tot.input += ans.input; tot.output += ans.output;
      const parsed = parseAiAnswer(ans.text, new Map(nights.map((n) => [n.night, n.currentRappen])), corridor);
      tot.rejected += parsed.rejected;
      const current = new Map(nights.map((n) => [n.night, n.currentRappen]));
      await db().transaction(async (tx) => {
        if (parsed.proposals.length) {
          await tx.delete(pricingProposals).where(and(eq(pricingProposals.hotelId, hotel.id), eq(pricingProposals.ratePlanId, plan.id), eq(pricingProposals.status, "open"), inArray(pricingProposals.night, parsed.proposals.map((p) => p.night))));
          await tx.insert(pricingProposals).values(parsed.proposals.map((p) => ({ hotelId: hotel.id, ratePlanId: plan.id, night: p.night, currentRappen: current.get(p.night)!, proposedRappen: p.priceRappen, reason: p.reason, source: "ai" as const })));
        }
      });
      tot.proposed += parsed.proposals.length;
      if (rule.autoApply && parsed.proposals.length) {
        const open = await db().select({ id: pricingProposals.id }).from(pricingProposals).where(and(eq(pricingProposals.hotelId, hotel.id), eq(pricingProposals.ratePlanId, plan.id), eq(pricingProposals.status, "open"), eq(pricingProposals.source, "ai")));
        tot.applied += await applyProposals(hotel.id, open.map((o) => o.id), `auto-ai:${actor}`);
      }
    }
  } catch (e) {
    const msg = e instanceof AiPricingError ? e.message : "Die KI-Berechnung ist fehlgeschlagen.";
    await db().insert(aiPricingRuns).values({ hotelId: hotel.id, day: today, status: "error", model: env().PRICING_MODEL, nights: tot.nights, inputTokens: tot.input, outputTokens: tot.output, error: msg });
    throw new AiPricingError(`${msg} Die Vorschläge nach Regeln bleiben bestehen.`);
  }
  await db().insert(aiPricingRuns).values({ hotelId: hotel.id, day: today, status: "ok", model: env().PRICING_MODEL, nights: tot.nights, proposals: tot.proposed, rejected: tot.rejected, inputTokens: tot.input, outputTokens: tot.output });
  await audit(db(), { hotelId: hotel.id, actor, action: "pricing.ai_run", entity: "hotel", entityId: hotel.id, details: { nights: tot.nights, proposed: tot.proposed, applied: tot.applied, rejected: tot.rejected } });
  return { proposed: tot.proposed, applied: tot.applied, rejected: tot.rejected };
}

/** Regeln neu rechnen und danach die KI darüberlegen; ohne KI-Modul nur die Regeln (Automatik der Regeln unverändert) */
export async function refreshProposals(hotel: Hotel, actor: string, opts: { fetcher?: FetchLike; now?: Date } = {}) {
  const today = todayIn(hotel.timezone, opts.now);
  const ai = await aiPricingActive(hotel.id);
  const base = await generateProposals(hotel.id, today, actor, 90, { skipAuto: ai });
  if (!ai) return { ...base, ai: null as null | { proposed: number; applied: number; rejected: number } };
  try { return { ...base, ai: await runAiPricing(hotel, actor, opts) }; }
  catch (e) {
    if (e instanceof AiPricingError) return { ...base, ai: null, aiError: e.message };
    throw e;
  }
}

/** Täglicher Job: Regeln und, wo eingeschaltet, KI */
export async function aiPricingJob(now = new Date()): Promise<number> {
  const on = await db().select({ hotelId: hotelModules.hotelId }).from(hotelModules).where(and(eq(hotelModules.module, "pricing_rules"), eq(hotelModules.enabled, true)));
  let n = 0;
  for (const { hotelId } of on) {
    const [h] = await db().select().from(hotels).where(eq(hotels.id, hotelId));
    if (!h) continue;
    const r = await refreshProposals(h, "job", { now });
    n += r.proposed + (r.ai?.proposed ?? 0);
  }
  return n;
}
