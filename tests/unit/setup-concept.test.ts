import { describe, expect, it } from "vitest";
import { initials } from "../../src/domain/avatar";
import { PAGE_NEEDS, NEEDS, setupBanner, setupOpen, unmetNeeds } from "../../src/domain/setup";
import { CHOICES, resolveModules, startModules } from "../../src/domain/module-choice";
import { MODULES } from "../../src/domain/modules";

const steps = (done: string[], open = ["betrieb", "unterkunft", "live"]) => [...new Set([...done, ...open])].map((key) => ({ key, done: done.includes(key), required: true }));

describe("Avatar-Initialen", () => {
  it("aus Name, sonst aus der E-Mail", () => {
    expect(initials("Ruth Keller", "x@y.ch")).toBe("RK");
    expect(initials("Anna Maria von Arx", "x@y.ch")).toBe("AA");
    expect(initials("Ruth", "x@y.ch")).toBe("RU");
    expect(initials(null, "ruth.keller@example.ch")).toBe("RK");
    expect(initials("", "mueller_hans@example.ch")).toBe("MH");
    expect(initials(null, "kellner@example.ch")).toBe("KE");
    expect(initials(null, "123@example.ch")).toBe("?");
    expect(initials("Éva Öztürk", "x@y.ch")).toBe("ÉÖ");
  });
});

describe("Hinweiszeile und Voraussetzungen", () => {
  const open = { status: "draft", onboarding: { startedAt: "2026-01-01" } };
  it("offen, fast fertig, live, pausiert", () => {
    expect(setupOpen(open)).toBe(true);
    expect(setupBanner(open, steps(["betrieb"]))).toMatchObject({ kind: "open", path: "einrichten", cta: "Einrichtung fortsetzen" });
    expect(setupBanner(open, steps(["betrieb", "unterkunft"]))).toMatchObject({ kind: "almost", path: "einrichten?step=live" });
    expect(setupBanner({ status: "live", onboarding: { startedAt: "a", completedAt: "b" } }, null)).toBeNull();
    expect(setupBanner({ status: "paused", onboarding: { startedAt: "a", completedAt: "b" } }, null)).toMatchObject({ kind: "paused", path: "settings" });
    expect(setupBanner({ status: "draft", onboarding: {} }, null)).toBeNull(); // Altbetrieb ohne Assistent
  });
  it("Voraussetzungen der Seiten", () => {
    expect(unmetNeeds(steps(["betrieb"]))).toEqual(["rooms"]);
    expect(unmetNeeds(steps(["betrieb", "unterkunft"]))).toEqual([]);
    for (const need of Object.values(PAGE_NEEDS)) expect(NEEDS[need]).toBeTruthy();
  });
});

describe("Funktionswahl", () => {
  it("Ferienwohnung ohne Rezeption, Hotel mit; alle Funktionen als feste Einträge", () => {
    expect(startModules(true).frontdesk).toBe(false);
    expect(startModules(false).frontdesk).toBe(true);
    expect(Object.keys(startModules(false)).sort()).toEqual(MODULES.map((m) => m.key).sort());
  });
  it("Auswahl zeigt auf echte Funktionen", () => {
    for (const c of CHOICES) for (const k of c.modules) expect(MODULES.some((m) => m.key === k), k).toBe(true);
  });
  it("Einschalten zieht Voraussetzungen mit, Ausschalten nimmt Abhängige mit, «an» gewinnt bei Widerspruch", () => {
    const base = startModules(true); // frontdesk aus
    expect(resolveModules(base, { housekeeping: true })).toEqual({ housekeeping: true, frontdesk: true });
    const hotel = { ...startModules(false), housekeeping: true, access: true };
    expect(resolveModules(hotel, { frontdesk: false })).toEqual({ frontdesk: false, housekeeping: false, access: false });
    expect(resolveModules(hotel, { frontdesk: false, housekeeping: true })).toEqual({}); // housekeeping gewünscht: frontdesk bleibt an
    expect(resolveModules(base, { pos: true })).toEqual({ pos: true, restaurant: true }); // invoicing läuft schon, Kasse braucht Restaurant (SPEC 20.1)
    expect(resolveModules({ ...base, invoicing: false }, { pos: true })).toEqual({ pos: true, invoicing: true, restaurant: true });
  });
});

describe("Funktionswahl «Personal»", () => {
  it("eine Frage für Rezeption und Reinigung; angekreuzt, sobald eine davon läuft", async () => {
    const { CHOICES, choiceOn } = await import("../../src/domain/module-choice");
    const staff = CHOICES.find((c) => c.key === "staff")!;
    expect(staff.modules).toEqual(["frontdesk", "housekeeping"]);
    expect(CHOICES.some((c) => c.key === "housekeeping")).toBe(false);
    const on = (keys: string[]) => (_: unknown, k: string) => keys.includes(k);
    expect(choiceOn([], staff, on(["frontdesk"]))).toBe(true);
    expect(choiceOn([], staff, on([]))).toBe(false);
  });
});
