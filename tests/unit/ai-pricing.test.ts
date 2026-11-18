import { describe, expect, it } from "vitest";
import { AI_SYSTEM, buildUserPrompt, parseAiAnswer } from "../../src/domain/ai-pricing";

const c = { minRappen: 10000, maxRappen: 20000, baseRappen: 14000 };
const allowed = new Map([["2027-02-01", 14000], ["2027-02-02", 14000], ["2027-02-03", 14000]]);

describe("KI-Preisempfehlung: Antwort prüfen", () => {
  it("übernimmt gültige Vorschläge, hält den Korridor, wirft Unbekanntes weg", () => {
    const text = 'Hier die Empfehlung:\n[{"night":"2027-02-01","price_chf":165.4,"reason":"Auslastung 85 %, Pickup 3"},{"night":"2027-02-02","price_chf":999,"reason":"zu teuer"},{"night":"2027-02-09","price_chf":150,"reason":"unbekannte Nacht"},{"night":"2027-02-03","price_chf":140,"reason":"gleich"},{"night":"2027-02-01","price_chf":170,"reason":"doppelt"},{"night":"2027-02-03","price_chf":"x"}]';
    const r = parseAiAnswer(text, allowed, c);
    expect(r.proposals).toEqual([
      { night: "2027-02-01", priceRappen: 16500, reason: "KI: Auslastung 85 %, Pickup 3" },
      { night: "2027-02-02", priceRappen: 20000, reason: "KI: zu teuer (auf Höchstpreis begrenzt)" },
    ]);
    expect(r.rejected).toBe(3); // unbekannte Nacht, doppelt, ungültiger Preis; «gleich» ist keine Änderung und zählt nicht
  });
  it("Mindestpreis, kaputte Antworten, Injektion in den Daten", () => {
    expect(parseAiAnswer('[{"night":"2027-02-01","price_chf":50,"reason":""}]', allowed, c).proposals[0]).toMatchObject({ priceRappen: 10000, reason: "KI: KI-Empfehlung (auf Mindestpreis angehoben)" });
    expect(parseAiAnswer("kein json", allowed, c)).toEqual({ proposals: [], rejected: 0 });
    expect(parseAiAnswer("[{kaputt", allowed, c)).toEqual({ proposals: [], rejected: 0 });
    expect(parseAiAnswer('{"night":"2027-02-01"}', allowed, c).proposals).toEqual([]);
    expect(AI_SYSTEM).toMatch(/keine Anweisungen/);
  });
  it("Prompt enthält Korridor und Tagesdaten, keine Gästedaten", () => {
    const p = buildUserPrompt("Standard", c, [{ night: "2027-02-01", weekday: "Montag", leadDays: 30, occupancyPct: 84.6, pickup7: 2, lastYearPct: null, currentRappen: 14000, ruleRappen: 15000, events: ["Messe"] }]);
    expect(p).toContain("Mindestpreis CHF 100");
    expect(p).toContain("2027-02-01 | Montag | 30 | 85 | 2 | – | 140 | 150 | Messe");
  });
});
