import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { auditLog, channexOutbox, inventoryDays, ratesDays } from "../../src/db/schema";
import { addEvent, applyProposals, dismissProposals, generateProposals, listProposals, PricingError, saveRule, type RuleInput } from "../../src/services/pricing-rules";
import { addDays, weekday } from "../../src/domain/dates";
import { inDays, makeHotel } from "../helpers";

afterAll(closeDb);

const input = (over: Partial<RuleInput> = {}): RuleInput => ({
  baseRappen: 20000, minRappen: 15000, maxRappen: 30000,
  occupancySteps: [{ fromPct: 50, bps: 2000 }], lastMinute: null, weekdayBps: [0, 0, 0, 0, 0, 0, 0], autoApply: false, active: true, ...over,
});
const price = async (planId: string, night: string) => (await db().select().from(ratesDays).where(and(eq(ratesDays.ratePlanId, planId), eq(ratesDays.night, night))))[0].priceRappen;

describe("Preisempfehlung (SPEC 19.3)", () => {
  it("schlägt vor, ändert aber nichts ohne Bestätigung; Übernahme schreibt Preis, Outbox und Audit", async () => {
    const h = await makeHotel();
    const rt = h.rooms[0].roomType.id, plan = h.rooms[0].plans[0].id;
    const today = inDays(0), night = inDays(10);
    await saveRule(h.hotel.id, plan, input(), "t");
    // 2 von 3 Zimmern gebucht = 67 % → +20 % → 240.-
    await db().update(inventoryDays).set({ booked: 2 }).where(and(eq(inventoryDays.roomTypeId, rt), eq(inventoryDays.night, night)));
    const before = await price(plan, night);
    const r = await generateProposals(h.hotel.id, today, "t");
    expect(r.proposed).toBeGreaterThan(0);
    expect(await price(plan, night)).toBe(before);
    const open = await listProposals(h.hotel.id, today);
    const p = open.find((x) => x.night === night)!;
    expect(p.proposedRappen).toBe(24000);
    expect(p.reason).toContain("Auslastung 67 %");
    const outboxBefore = (await db().select().from(channexOutbox).where(eq(channexOutbox.hotelId, h.hotel.id))).length;
    expect(await applyProposals(h.hotel.id, [p.id], "martin")).toBe(1);
    expect(await price(plan, night)).toBe(24000);
    expect((await db().select().from(channexOutbox).where(eq(channexOutbox.hotelId, h.hotel.id))).length).toBeGreaterThan(outboxBefore);
    expect((await db().select().from(auditLog).where(and(eq(auditLog.hotelId, h.hotel.id), eq(auditLog.action, "rates.update")))).length).toBeGreaterThan(0);
    expect(await applyProposals(h.hotel.id, [p.id], "martin")).toBe(0); // schon übernommen
  });

  it("Ereignis wirkt, verworfener Vorschlag kommt mit gleichem Preis nicht wieder", async () => {
    const h = await makeHotel();
    const plan = h.rooms[0].plans[0].id;
    const night = inDays(12);
    await saveRule(h.hotel.id, plan, input({ occupancySteps: [] }), "t");
    await addEvent(h.hotel.id, { name: "Messe", fromDay: night, toDay: night, adjustBps: 1000 }, "t");
    await generateProposals(h.hotel.id, inDays(0), "t");
    const p = (await listProposals(h.hotel.id, inDays(0))).find((x) => x.night === night)!;
    expect(p.proposedRappen).toBe(22000);
    expect(p.reason).toContain("Messe");
    await dismissProposals(h.hotel.id, [p.id], "t");
    await generateProposals(h.hotel.id, inDays(0), "t");
    expect((await listProposals(h.hotel.id, inDays(0))).some((x) => x.night === night)).toBe(false);
  });

  it("automatisch übernehmen bleibt im Preiskorridor", async () => {
    const h = await makeHotel();
    const plan = h.rooms[0].plans[0].id;
    const night = addDays(inDays(0), 5);
    const wd = Array(7).fill(0); wd[weekday(night)] = 10000; // +100 %
    await saveRule(h.hotel.id, plan, input({ occupancySteps: [], weekdayBps: wd, autoApply: true, maxRappen: 26000 }), "t");
    const r = await generateProposals(h.hotel.id, inDays(0), "t");
    expect(r.applied).toBeGreaterThan(0);
    expect(await price(plan, night)).toBe(26000);
    expect((await listProposals(h.hotel.id, inDays(0))).length).toBe(0);
  });

  it("Regel prüft Eingaben und gehört zum Betrieb", async () => {
    const h = await makeHotel(), other = await makeHotel();
    await expect(saveRule(h.hotel.id, h.rooms[0].plans[0].id, input({ maxRappen: 100 }), "t")).rejects.toBeInstanceOf(PricingError);
    await expect(saveRule(other.hotel.id, h.rooms[0].plans[0].id, input(), "t")).rejects.toBeInstanceOf(PricingError);
    await expect(addEvent(h.hotel.id, { name: "x", fromDay: "2026-05-02", toDay: "2026-05-01", adjustBps: 100 }, "t")).rejects.toBeInstanceOf(PricingError);
  });
});
