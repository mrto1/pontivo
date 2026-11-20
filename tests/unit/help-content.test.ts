import { describe, expect, it } from "vitest";
import { adminNav, allPages } from "../../src/admin/nav";
import { FLOWS, TERMS, TERM_GROUPS, WAYFINDING, flowsFor } from "../../src/domain/help-content";

const keys = new Set(allPages(adminNav({ id: "h", slug: "s", primaryDomain: null })).map((p) => p.key));

describe("Schulungsunterlagen (Hilfe)", () => {
  it("jeder Verweis zeigt auf einen echten Menüpunkt", () => {
    for (const w of WAYFINDING) expect(keys.has(w.area), `Wegweiser ${w.title}: ${w.area}`).toBe(true);
    for (const f of FLOWS) expect(keys.has(f.area), `Ablauf ${f.key}: ${f.area}`).toBe(true);
    for (const t of TERMS) if (t.area) expect(keys.has(t.area), `Begriff ${t.term}: ${t.area}`).toBe(true);
  });
  it("eindeutige Schlüssel und Begriffe, jeder Ablauf hat Schritte", () => {
    expect(new Set(FLOWS.map((f) => f.key)).size).toBe(FLOWS.length);
    expect(new Set(TERMS.map((t) => t.term)).size).toBe(TERMS.length);
    for (const f of FLOWS) expect(f.steps.length).toBeGreaterThanOrEqual(2);
    for (const t of TERMS) { expect(t.meaning.length).toBeGreaterThan(20); expect(t.inPontivo.length).toBeGreaterThan(20); }
    expect(TERM_GROUPS.length).toBeGreaterThanOrEqual(5);
  });
  it("jede Rolle bekommt Abläufe, Inhaber alle", () => {
    expect(flowsFor("owner")).toHaveLength(FLOWS.length);
    for (const r of ["reception", "housekeeping", "accounting", "service"] as const) expect(flowsFor(r).length, r).toBeGreaterThan(0);
  });
});
