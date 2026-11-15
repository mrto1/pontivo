import { describe, expect, it } from "vitest";
import { cleanOverrides, DEFAULT_FAQ, resolveSite, SITE_FIELDS } from "../../src/domain/pontivo-site";

const vars = { name: "Pontivo", fee: 1.9, email: "info@pontivo.ch" };

describe("Pontivo-Startseite: Texte", () => {
  it("jeder Standardtext ist nicht leer, Schlüssel sind eindeutig", () => {
    expect(new Set(SITE_FIELDS.map((f) => f.key)).size).toBe(SITE_FIELDS.length);
    for (const f of SITE_FIELDS) expect(f.default.trim().length, f.key).toBeGreaterThan(0);
    expect(DEFAULT_FAQ).toHaveLength(11);
  });
  it("ohne Überschreibung gelten die Standardtexte, Platzhalter werden ersetzt", () => {
    const s = resolveSite(null, vars);
    expect(s.text("hero.lead")).toContain("Pontivo bringt Online-Buchung");
    expect(s.text("hero.lead")).toContain("1.9 % pro Direktbuchung");
    expect(s.text("hero.lead")).not.toContain("{");
    expect(s.faq[9].a).toContain("per E-Mail an info@pontivo.ch;");
    expect(resolveSite(null, { ...vars, email: undefined }).faq[9].a).toContain("per E-Mail; zu Unrecht");
    expect(s.lines("wege.1.bullets")).toHaveLength(3);
  });
  it("Überschreibung gilt, leere Überschreibung zählt als Standard, FAQ-Liste ersetzt die Standardliste", () => {
    const s = resolveSite({ texts: { "hero.title": "Neuer Titel für {name}", "hero.ctaMain": "  " }, faq: [{ q: "Frage?", a: "Antwort {fee} %" }] }, vars);
    expect(s.text("hero.title")).toBe("Neuer Titel für Pontivo");
    expect(s.text("hero.ctaMain")).toBe("Jetzt selbst einrichten");
    expect(s.faq).toEqual([{ q: "Frage?", a: "Antwort 1.9 %" }]);
  });
  it("Bereinigen: nur bekannte Schlüssel, gleich wie Standard oder leer = keine Überschreibung, leere FAQ-Zeilen entfallen", () => {
    const def = SITE_FIELDS.find((f) => f.key === "hero.title")!.default;
    const o = cleanOverrides({
      texts: { "hero.title": def, "hero.ctaMain": "Los", "unbekannt": "x", "hero.ctaSecond": "   " },
      faq: [{ q: "A?", a: "B" }, { q: "", a: "nur Antwort" }, { q: "nur Frage", a: "" }],
    });
    expect(o.texts).toEqual({ "hero.ctaMain": "Los" });
    expect(o.faq).toEqual([{ q: "A?", a: "B" }]);
    // unveränderte FAQ-Liste = Standard
    expect(cleanOverrides({ texts: {}, faq: DEFAULT_FAQ.map((f) => ({ ...f })) }).faq).toBeNull();
    expect(cleanOverrides({ texts: {}, faq: [] }).faq).toBeNull();
  });
  it("Länge wird begrenzt", () => {
    expect(cleanOverrides({ texts: { "hero.lead": "x".repeat(5000) }, faq: [] }).texts["hero.lead"]).toHaveLength(1500);
  });
});
