import { UserError } from "../domain/errors";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  hotelModules, hotels, inventoryDays, pricingEvents, pricingProposals, pricingRules, ratePlans, ratesDays,
  type LastMinuteRule, type OccupancyStep, type PricingEvent, type PricingProposal, type PricingRule,
} from "../db/schema";
import { addDays, diffDays, isDay, todayIn, weekday } from "../domain/dates";
import { proposePrice, validateRule, type Rule } from "../domain/pricing-rules";
import { audit } from "./audit";
import { updateRatesBatch } from "./inventory";

export class PricingError extends UserError {}

export type RuleInput = {
  baseRappen: number; minRappen: number; maxRappen: number;
  occupancySteps: OccupancyStep[]; lastMinute: LastMinuteRule | null; weekdayBps: number[]; autoApply: boolean; active: boolean;
};

export async function listRules(hotelId: string): Promise<PricingRule[]> {
  return db().select().from(pricingRules).where(eq(pricingRules.hotelId, hotelId));
}

export async function saveRule(hotelId: string, ratePlanId: string, input: RuleInput, actor: string): Promise<void> {
  const problem = validateRule(input);
  if (problem) throw new PricingError(problem);
  await db().transaction(async (tx) => {
    const [plan] = await tx.select({ id: ratePlans.id }).from(ratePlans).where(and(eq(ratePlans.id, ratePlanId), eq(ratePlans.hotelId, hotelId)));
    if (!plan) throw new PricingError("Tarif nicht gefunden.");
    const values = { ...input, updatedAt: new Date() };
    await tx.insert(pricingRules).values({ hotelId, ratePlanId, ...values })
      .onConflictDoUpdate({ target: pricingRules.ratePlanId, set: values, setWhere: eq(pricingRules.hotelId, hotelId) });
    await audit(tx, { hotelId, actor, action: "pricing.rule.save", entity: "rate_plan", entityId: ratePlanId, details: { ...input } });
  });
}

export async function listEvents(hotelId: string, fromDay: string): Promise<PricingEvent[]> {
  return db().select().from(pricingEvents).where(and(eq(pricingEvents.hotelId, hotelId), gte(pricingEvents.toDay, fromDay))).orderBy(pricingEvents.fromDay);
}

export async function addEvent(hotelId: string, e: { name: string; fromDay: string; toDay: string; adjustBps: number }, actor: string): Promise<void> {
  const name = e.name.trim();
  if (!name) throw new PricingError("Name fehlt.");
  if (!isDay(e.fromDay) || !isDay(e.toDay) || e.toDay < e.fromDay) throw new PricingError("Zeitraum ungültig.");
  if (!Number.isSafeInteger(e.adjustBps) || e.adjustBps === 0 || Math.abs(e.adjustBps) > 10000) throw new PricingError("Zuschlag ungültig (höchstens ±100 %).");
  await db().transaction(async (tx) => {
    const [row] = await tx.insert(pricingEvents).values({ hotelId, name, fromDay: e.fromDay, toDay: e.toDay, adjustBps: e.adjustBps }).returning({ id: pricingEvents.id });
    await audit(tx, { hotelId, actor, action: "pricing.event.add", entity: "pricing_event", entityId: row.id, details: { ...e, name } });
  });
}

export async function deleteEvent(hotelId: string, id: string, actor: string): Promise<void> {
  await db().transaction(async (tx) => {
    const res = await tx.delete(pricingEvents).where(and(eq(pricingEvents.id, id), eq(pricingEvents.hotelId, hotelId))).returning({ id: pricingEvents.id });
    if (res.length) await audit(tx, { hotelId, actor, action: "pricing.event.delete", entity: "pricing_event", entityId: id });
  });
}

/**
 * Vorschläge für die nächsten `days` Nächte berechnen (ersetzt die offenen). Mit auto_apply werden sie sofort übernommen:
 * der Preis ist durch Minimum/Maximum der Regel begrenzt.
 * ASSUMPTION: Nur Nächte mit vorhandenem Preis und ohne Verkaufsstopp werden bearbeitet; Auslastung = gebucht / (Zimmer − gesperrt) des Zimmertyps.
 */
export async function generateProposals(hotelId: string, today: string, actor: string, days = 90, opts: { skipAuto?: boolean } = {}): Promise<{ proposed: number; applied: number }> {
  const rules = (await listRules(hotelId)).filter((r) => r.active);
  if (!rules.length) return { proposed: 0, applied: 0 };
  const to = addDays(today, days - 1);
  const events = await db().select().from(pricingEvents).where(and(eq(pricingEvents.hotelId, hotelId), lte(pricingEvents.fromDay, to), gte(pricingEvents.toDay, today)));
  let proposed = 0;
  let applied = 0;
  for (const rule of rules) {
    const [plan] = await db().select().from(ratePlans).where(and(eq(ratePlans.id, rule.ratePlanId), eq(ratePlans.hotelId, hotelId)));
    if (!plan || !plan.active) continue;
    const inv = new Map((await db().select().from(inventoryDays).where(and(eq(inventoryDays.hotelId, hotelId), eq(inventoryDays.roomTypeId, plan.roomTypeId), gte(inventoryDays.night, today), lte(inventoryDays.night, to)))).map((i) => [i.night, i]));
    const rates = await db().select().from(ratesDays).where(and(eq(ratesDays.hotelId, hotelId), eq(ratesDays.ratePlanId, plan.id), gte(ratesDays.night, today), lte(ratesDays.night, to)));
    const dismissed = new Set((await db().select({ n: pricingProposals.night, p: pricingProposals.proposedRappen }).from(pricingProposals)
      .where(and(eq(pricingProposals.hotelId, hotelId), eq(pricingProposals.ratePlanId, plan.id), eq(pricingProposals.status, "dismissed"), gte(pricingProposals.night, today)))).map((d) => `${d.n}:${d.p}`));
    const toRule: Rule = { baseRappen: rule.baseRappen, minRappen: rule.minRappen, maxRappen: rule.maxRappen, occupancySteps: rule.occupancySteps, lastMinute: rule.lastMinute, weekdayBps: rule.weekdayBps };
    const rows: { night: string; current: number; proposed: number; reason: string }[] = [];
    for (const r of rates) {
      const i = inv.get(r.night);
      if (!i || r.stopSell) continue;
      const sellable = i.total - i.blocked - i.externalBlocked;
      if (sellable <= 0) continue;
      const res = proposePrice(toRule, {
        occupancyPct: (i.booked / sellable) * 100,
        leadDays: diffDays(today, r.night),
        weekday: weekday(r.night),
        events: events.filter((e) => e.fromDay <= r.night && e.toDay >= r.night).map((e) => ({ name: e.name, bps: e.adjustBps })),
      });
      if (res.priceRappen === r.priceRappen || dismissed.has(`${r.night}:${res.priceRappen}`)) continue;
      rows.push({ night: r.night, current: r.priceRappen, proposed: res.priceRappen, reason: res.reason });
    }
    await db().transaction(async (tx) => {
      await tx.delete(pricingProposals).where(and(eq(pricingProposals.hotelId, hotelId), eq(pricingProposals.ratePlanId, plan.id), eq(pricingProposals.status, "open")));
      if (rows.length) await tx.insert(pricingProposals).values(rows.map((r) => ({ hotelId, ratePlanId: plan.id, night: r.night, currentRappen: r.current, proposedRappen: r.proposed, reason: r.reason })));
    });
    proposed += rows.length;
    if (rule.autoApply && rows.length && !opts.skipAuto) {
      const open = await db().select({ id: pricingProposals.id }).from(pricingProposals).where(and(eq(pricingProposals.hotelId, hotelId), eq(pricingProposals.ratePlanId, plan.id), eq(pricingProposals.status, "open")));
      applied += await applyProposals(hotelId, open.map((o) => o.id), `auto:${actor}`);
    }
  }
  return { proposed, applied };
}

export async function listProposals(hotelId: string, from: string): Promise<(PricingProposal & { planName: string })[]> {
  const rows = await db().select({ p: pricingProposals, planName: ratePlans.name }).from(pricingProposals)
    .innerJoin(ratePlans, eq(ratePlans.id, pricingProposals.ratePlanId))
    .where(and(eq(pricingProposals.hotelId, hotelId), eq(pricingProposals.status, "open"), gte(pricingProposals.night, from)))
    .orderBy(pricingProposals.night);
  return rows.map((r) => ({ ...r.p, planName: r.planName }));
}

/** Vorschläge übernehmen: Preis in den Kalender (mit Channex-Outbox und Audit, über updateRatesBatch), dann als übernommen markieren. */
export async function applyProposals(hotelId: string, ids: string[], actor: string): Promise<number> {
  if (!ids.length) return 0;
  const open = await db().select().from(pricingProposals).where(and(eq(pricingProposals.hotelId, hotelId), eq(pricingProposals.status, "open"), inArray(pricingProposals.id, ids)));
  if (!open.length) return 0;
  const rules = new Map((await listRules(hotelId)).map((r) => [r.ratePlanId, r]));
  // Sicherheit: nie ausserhalb des Preiskorridors der Regel schreiben
  const safe = open.filter((p) => { const r = rules.get(p.ratePlanId); return r && p.proposedRappen >= r.minRappen && p.proposedRappen <= r.maxRappen; });
  if (safe.length) {
    await updateRatesBatch(hotelId, safe.map((p) => ({ ratePlanId: p.ratePlanId, from: p.night, to: p.night, change: { priceRappen: p.proposedRappen } })), { actor });
    await db().update(pricingProposals).set({ status: "applied", decidedAt: new Date(), decidedBy: actor })
      .where(and(eq(pricingProposals.hotelId, hotelId), inArray(pricingProposals.id, safe.map((p) => p.id))));
  }
  return safe.length;
}

export async function dismissProposals(hotelId: string, ids: string[], actor: string): Promise<void> {
  if (!ids.length) return;
  await db().update(pricingProposals).set({ status: "dismissed", decidedAt: new Date(), decidedBy: actor })
    .where(and(eq(pricingProposals.hotelId, hotelId), eq(pricingProposals.status, "open"), inArray(pricingProposals.id, ids)));
}
