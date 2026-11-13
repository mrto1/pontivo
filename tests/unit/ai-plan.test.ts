import { describe, expect, it } from "vitest";
import { aiBillForMonth, allowedConversations, endOfMonthOf, moduleActiveOn, moduleBillable, packsUsed, sessionContinues, type AiModuleSettings, type AiTerms } from "../../src/domain/ai-plan";

const basic: AiTerms = { planCode: "basic", name: "Basis", priceRappen: 1900, included: 250, packSize: 100, packPriceRappen: 500, acceptedAt: "2026-11-01T00:00:00Z", acceptedBy: "t" };
const mini: AiTerms = { planCode: "mini", name: "Mini", priceRappen: 490, included: 50, packSize: 0, packPriceRappen: 0, acceptedAt: "2026-11-01T00:00:00Z", acceptedBy: "t" };

describe("KI-Chat: Kontingent und Pakete", () => {
  it("angebrochene Pakete zählen voll", () => {
    expect(packsUsed(250, 250, 100)).toBe(0);
    expect(packsUsed(251, 250, 100)).toBe(1);
    expect(packsUsed(350, 250, 100)).toBe(1);
    expect(packsUsed(351, 250, 100)).toBe(2);
    expect(packsUsed(999, 50, 0)).toBe(0); // Mini: keine Zusatzpakete
  });

  it("erlaubte Gespräche: Kontingent + Pakete im Budget, begrenzt durch die Obergrenze", () => {
    expect(allowedConversations(basic, 0, 5000)).toBe(250);
    expect(allowedConversations(basic, 499, 5000)).toBe(250);
    expect(allowedConversations(basic, 500, 5000)).toBe(350);
    expect(allowedConversations(basic, 2000, 5000)).toBe(650);
    expect(allowedConversations(basic, 100_000, 400)).toBe(400);
    expect(allowedConversations(mini, 5000, 5000)).toBe(50);
  });

  it("Sitzung: endet nach 30 Minuten Pause oder 20 Nachrichten", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    expect(sessionContinues({ messages: 3, lastAt: new Date(now.getTime() - 29 * 60_000) }, now)).toBe(true);
    expect(sessionContinues({ messages: 3, lastAt: new Date(now.getTime() - 31 * 60_000) }, now)).toBe(false);
    expect(sessionContinues({ messages: 20, lastAt: now }, now)).toBe(false);
    expect(sessionContinues({ messages: 19, lastAt: now }, now)).toBe(true);
  });
});

describe("KI-Chat: Laufzeit und Abrechnung", () => {
  const s: AiModuleSettings = { terms: basic, enabledSince: "2026-09-10", endsAt: null, freeMonth: "2026-09", overageBudgetRappen: 1000 };

  it("läuft zwischen Beginn und Kündigung", () => {
    expect(moduleActiveOn(true, s, "2026-11-13")).toBe(true);
    expect(moduleActiveOn(false, s, "2026-11-13")).toBe(false);
    expect(moduleActiveOn(true, { ...s, endsAt: "2026-11-30" }, "2026-11-30")).toBe(true);
    expect(moduleActiveOn(true, { ...s, endsAt: "2026-11-30" }, "2026-12-01")).toBe(false);
    expect(moduleActiveOn(true, { ...s, enabledSince: "2026-12-01" }, "2026-11-13")).toBe(false);
    expect(endOfMonthOf("2026-02-10")).toBe("2026-02-28");
  });

  it("Gratismonat nur einmal, Monate ohne Laufzeit werden nicht berechnet", () => {
    expect(moduleBillable("2026-09", s)).toBe(false); // erster Monat frei
    expect(moduleBillable("2026-10", s)).toBe(true);
    expect(moduleBillable("2026-08", s)).toBe(false); // vor Beginn
    const ended = { ...s, endsAt: "2026-10-31" };
    expect(moduleBillable("2026-10", ended)).toBe(true); // Kündigungsmonat wird noch berechnet
    expect(moduleBillable("2026-11", ended)).toBe(false);
    // Neu eingeschaltet nach Unterbruch: neuer Beginn, aber der Gratismonat bleibt der alte
    const again = { ...s, enabledSince: "2027-03-05", endsAt: null };
    expect(moduleBillable("2027-03", again)).toBe(true);
    expect(moduleBillable("2026-12", again)).toBe(false);
  });

  it("Betrag = Modulpreis + Zusatzpakete bis zum Budget, nie darüber", () => {
    expect(aiBillForMonth("2026-10", s, 200)).toMatchObject({ moduleRappen: 1900, packsRappen: 0, totalRappen: 1900 });
    expect(aiBillForMonth("2026-10", s, 251)).toMatchObject({ packs: 1, packsRappen: 500, totalRappen: 2400 });
    // Budget 10 CHF = 2 Pakete, mehr wird nicht berechnet
    expect(aiBillForMonth("2026-10", s, 900)).toMatchObject({ packs: 2, packsRappen: 1000, totalRappen: 2900 });
    expect(aiBillForMonth("2026-10", { ...s, overageBudgetRappen: 0 }, 900)).toMatchObject({ packs: 0, totalRappen: 1900 });
    expect(aiBillForMonth("2026-09", s, 251)).toMatchObject({ moduleRappen: 0, packsRappen: 500, totalRappen: 500 });
    expect(aiBillForMonth("2026-10", { terms: mini, enabledSince: "2026-01-01", overageBudgetRappen: 0 }, 80)).toMatchObject({ moduleRappen: 490, totalRappen: 490 });
    expect(aiBillForMonth("2026-10", {}, 10).totalRappen).toBe(0);
  });
});
