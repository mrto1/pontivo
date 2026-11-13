import { and, eq, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { aiPlans, hotelModules, type AiPlan, type Hotel } from "../db/schema";
import { aiBillForMonth, allowedConversations, endOfMonthOf, moduleActiveOn, packsUsed, type AiModuleSettings, type AiMonthBill, type AiTerms } from "../domain/ai-plan";
import { todayIn } from "../domain/dates";
import { env } from "../env";
import { HOST_TERMS_VERSION } from "../legal/host-terms";
import { audit } from "./audit";

/**
 * Modul «KI-Chat» (SPEC 14b): Einschalten mit Preisbestätigung, Kündigung zum Monatsende, Budget für Zusatzpakete,
 * Nutzungsübersicht und Abrechnung. Die Konditionen werden beim Einschalten kopiert (hotel_modules.settings.terms).
 */

export class AiModuleError extends Error {}

export const AI_MODULE = "ai_chat";

export async function aiModuleRow(hotelId: string): Promise<{ enabled: boolean; settings: AiModuleSettings }> {
  const [m] = await db().select().from(hotelModules).where(and(eq(hotelModules.hotelId, hotelId), eq(hotelModules.module, AI_MODULE)));
  return { enabled: !!m?.enabled, settings: (m?.settings ?? {}) as AiModuleSettings };
}

/** Läuft der Chat für dieses Hotel heute? (Modul an, Laufzeit nicht abgelaufen, API-Schlüssel gesetzt) */
export async function aiChatActive(hotel: Hotel, now = new Date()): Promise<{ active: boolean; settings: AiModuleSettings }> {
  const m = await aiModuleRow(hotel.id);
  const active = !!env().ANTHROPIC_API_KEY && moduleActiveOn(m.enabled, m.settings, todayIn(hotel.timezone, now));
  return { active, settings: m.settings };
}

/** Tarife, die das Hotel heute wählen kann */
export async function offeredPlans(): Promise<AiPlan[]> {
  return db().select().from(aiPlans).where(eq(aiPlans.active, true)).orderBy(aiPlans.priceRappen);
}

export async function enableAiChat(hotel: Hotel, planCode: string, confirmedPriceRappen: number, actor: string, now = new Date()): Promise<void> {
  const [plan] = await db().select().from(aiPlans).where(and(eq(aiPlans.code, planCode), eq(aiPlans.active, true)));
  if (!plan) throw new AiModuleError("Dieser Tarif ist nicht verfügbar.");
  // Preisbestätigung: das Hotel hat genau den Preis gesehen, den wir jetzt festschreiben
  if (confirmedPriceRappen !== plan.priceRappen) throw new AiModuleError("Der Preis hat sich geändert. Bitte die Seite neu laden und erneut bestätigen.");
  if (!hotel.billingPaymentMethodId) throw new AiModuleError("Bitte zuerst eine Karte für die Abrechnung hinterlegen (Abrechnung → Karte).");
  const today = todayIn(hotel.timezone, now);
  await db().transaction(async (tx) => {
    const [cur] = await tx.select().from(hotelModules).where(and(eq(hotelModules.hotelId, hotel.id), eq(hotelModules.module, AI_MODULE))).for("update");
    const old = (cur?.settings ?? {}) as AiModuleSettings;
    const terms: AiTerms = {
      planCode: plan.code, name: plan.name, priceRappen: plan.priceRappen, included: plan.includedConversations,
      packSize: plan.packSize, packPriceRappen: plan.packPriceRappen, acceptedAt: now.toISOString(), acceptedBy: actor, termsVersion: HOST_TERMS_VERSION,
    };
    // Läuft die Laufzeit noch (Kündigung zurücknehmen), bleibt der Beginn; sonst beginnt eine neue Laufzeit. Der Gratismonat gilt nur beim allerersten Mal.
    const running = cur?.enabled && old.enabledSince && (!old.endsAt || old.endsAt >= today);
    const settings: AiModuleSettings = {
      ...old, terms, endsAt: null,
      enabledSince: running ? old.enabledSince : today,
      freeMonth: old.freeMonth ?? today.slice(0, 7),
      overageBudgetRappen: plan.packSize > 0 ? old.overageBudgetRappen ?? 0 : 0,
    };
    await tx.insert(hotelModules).values({ hotelId: hotel.id, module: AI_MODULE, enabled: true, settings })
      .onConflictDoUpdate({ target: [hotelModules.hotelId, hotelModules.module], set: { enabled: true, settings } });
    await audit(tx, { hotelId: hotel.id, actor, action: "module.ai_chat.on", entity: "hotel", entityId: hotel.id, details: { plan: plan.code, priceRappen: plan.priceRappen } });
  });
}

/** Kündigung: der Chat läuft bis Ende des laufenden Monats */
export async function cancelAiChat(hotel: Hotel, actor: string, now = new Date()): Promise<void> {
  const today = todayIn(hotel.timezone, now);
  await db().transaction(async (tx) => {
    const [cur] = await tx.select().from(hotelModules).where(and(eq(hotelModules.hotelId, hotel.id), eq(hotelModules.module, AI_MODULE))).for("update");
    if (!cur?.enabled) return;
    const settings = { ...(cur.settings as AiModuleSettings), endsAt: endOfMonthOf(today) };
    await tx.update(hotelModules).set({ settings }).where(and(eq(hotelModules.hotelId, hotel.id), eq(hotelModules.module, AI_MODULE)));
    await audit(tx, { hotelId: hotel.id, actor, action: "module.ai_chat.cancel", entity: "hotel", entityId: hotel.id, details: { endsAt: settings.endsAt } });
  });
}

/** Monatsbudget für Zusatzpakete (Rappen, 0 = aus). Nur sinnvoll, wenn der Tarif Zusatzpakete hat. */
export async function setAiBudget(hotel: Hotel, budgetRappen: number, actor: string): Promise<void> {
  if (!Number.isInteger(budgetRappen) || budgetRappen < 0 || budgetRappen > 100_000) throw new AiModuleError("Ungültiges Budget.");
  await db().transaction(async (tx) => {
    const [cur] = await tx.select().from(hotelModules).where(and(eq(hotelModules.hotelId, hotel.id), eq(hotelModules.module, AI_MODULE))).for("update");
    const s = (cur?.settings ?? {}) as AiModuleSettings;
    if (!cur?.enabled || !s.terms) throw new AiModuleError("Das Modul ist nicht eingeschaltet.");
    if (s.terms.packSize <= 0 && budgetRappen > 0) throw new AiModuleError("Dieser Tarif hat keine Zusatzpakete.");
    await tx.update(hotelModules).set({ settings: { ...s, overageBudgetRappen: budgetRappen } }).where(and(eq(hotelModules.hotelId, hotel.id), eq(hotelModules.module, AI_MODULE)));
    await audit(tx, { hotelId: hotel.id, actor, action: "module.ai_chat.budget", entity: "hotel", entityId: hotel.id, details: { budgetRappen } });
  });
}

export async function conversationsInMonth(hotelId: string, month: string): Promise<number> {
  const [r] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM ai_usage WHERE hotel_id = ${hotelId} AND month = ${month}`));
  return r?.n ?? 0;
}

export type AiUsageSummary = {
  month: string; conversations: number; included: number; allowed: number; packs: number; packsRappen: number; paused: boolean;
  inputTokens: number; outputTokens: number;
};

export async function aiUsageSummary(hotel: Hotel, month: string): Promise<AiUsageSummary | null> {
  const { settings } = await aiModuleRow(hotel.id);
  const t = settings.terms;
  if (!t) return null;
  const [u] = rows<{ n: number; i: number; o: number }>(await db().execute(sql`
    SELECT count(*)::int AS n, coalesce(sum(input_tokens),0)::int AS i, coalesce(sum(output_tokens),0)::int AS o FROM ai_usage WHERE hotel_id = ${hotel.id} AND month = ${month}`));
  const allowed = allowedConversations(t, settings.overageBudgetRappen ?? 0, env().AI_CHAT_HARD_CAP);
  const packs = packsUsed(u.n, t.included, t.packSize);
  return { month, conversations: u.n, included: t.included, allowed, packs, packsRappen: packs * t.packPriceRappen, paused: u.n >= allowed, inputTokens: u.i, outputTokens: u.o };
}

/** Abrechnung des Monats für ein Hotel (für billing.ts) */
export async function aiBillFor(hotelId: string, month: string): Promise<AiMonthBill> {
  const { settings } = await aiModuleRow(hotelId);
  if (!settings.terms) return { moduleRappen: 0, packsRappen: 0, packs: 0, conversations: 0, totalRappen: 0 };
  return aiBillForMonth(month, settings, await conversationsInMonth(hotelId, month));
}

/** Hotels, die irgendwann den KI-Chat gebucht haben (für den Monatslauf) */
export async function hotelsWithAiModule(): Promise<string[]> {
  return rows<{ hotel_id: string }>(await db().execute(sql`SELECT hotel_id FROM hotel_modules WHERE module = ${AI_MODULE} AND settings ? 'terms'`)).map((r) => r.hotel_id);
}

