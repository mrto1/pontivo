import { describe, expect, it } from "vitest";
import { MAIL_TEMPLATES, fillTemplate, funnelOf, isDue, templateById } from "../../src/domain/sales";

describe("Vertriebs-Cockpit: Logik", () => {
  it("Platzhalter werden gefüllt, ohne Kontaktname bleibt eine saubere Anrede", () => {
    const v = { kontakt: "Frau Keller", betrieb: "Hotel Alpenblick", absender: "Martin", plattform: "Pontivo" };
    const t = fillTemplate(templateById("erstkontakt")!.body, v);
    expect(t).toContain("Guten Tag Frau Keller");
    expect(t).toContain("Hotel Alpenblick");
    expect(t).not.toMatch(/\{\w+\}/);
    expect(fillTemplate(templateById("erstkontakt")!.body, { ...v, kontakt: "" }).startsWith("Guten Tag\n")).toBe(true);
  });

  it("alle Vorlagen verwenden nur bekannte Platzhalter", () => {
    for (const t of MAIL_TEMPLATES) {
      const filled = fillTemplate(`${t.subject}\n${t.body}`, { kontakt: "K", betrieb: "B", absender: "A", plattform: "P" });
      expect(filled, t.id).not.toMatch(/\{\w+\}/);
    }
  });

  it("Trichter zählt Status und Abschlussquote", () => {
    const f = funnelOf(["neu", "neu", "demo", "gewonnen", "gewonnen", "gewonnen", "verloren"]);
    expect(f.counts).toMatchObject({ neu: 2, demo: 1, gewonnen: 3, verloren: 1, kontaktiert: 0 });
    expect(f.open).toBe(3);
    expect(f.winRate).toBe(0.75);
    expect(funnelOf(["neu"]).winRate).toBeNull();
  });

  it("fällig: nur offene Leads mit Datum heute oder früher", () => {
    expect(isDue({ status: "neu", nextActionAt: "2026-11-20" }, "2026-11-20")).toBe(true);
    expect(isDue({ status: "neu", nextActionAt: "2026-11-21" }, "2026-11-20")).toBe(false);
    expect(isDue({ status: "gewonnen", nextActionAt: "2026-11-01" }, "2026-11-20")).toBe(false);
    expect(isDue({ status: "demo", nextActionAt: null }, "2026-11-20")).toBe(false);
  });
});
