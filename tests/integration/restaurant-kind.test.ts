import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { closeDb, db } from "../../src/db/client";
import { hotelModules, hotels } from "../../src/db/schema";
import { isOn } from "../../src/domain/modules";
import { addDays, todayIn } from "../../src/domain/dates";
import { onboardingSteps, quickTables, registerHost } from "../../src/services/onboarding";
import { goLiveProblems } from "../../src/services/settings";
import { applyModules, moduleRows } from "../../src/services/modules";
import { listTables } from "../../src/services/pos";
import { getSettings, saveOpeningHours, saveSettings, slotsFor } from "../../src/services/reservations";
import { makeHotel } from "../helpers";

afterAll(closeDb);
const uid = () => Math.random().toString(36).slice(2, 8);

async function restaurant() {
  const { hotel } = await registerHost({ propertyType: "restaurant", name: `Beiz ${uid()}`, contactName: "Anna Wirt", email: `wirt-${uid()}@example.ch`, canton: "SG", municipality: "St. Gallen", acceptTerms: true }, new Date(), { noLogin: true });
  return hotel;
}

describe("Betriebsart Restaurant (SPEC 20.1)", () => {
  it("Registrierung: Startfunktionen ohne Zimmer-Module, Restaurant an, Kasse aus", async () => {
    const h = await restaurant();
    expect(h.propertyType).toBe("restaurant");
    const rows = await moduleRows(h.id);
    expect(isOn(rows, "restaurant")).toBe(true);
    for (const k of ["pos", "frontdesk", "housekeeping", "statistics", "guests", "groups"]) expect(isOn(rows, k), k).toBe(false);
  });

  it("Assistent: eigene Schritte, keine Kurtaxe und kein Stripe-Zwang beim Live-Gang", async () => {
    const h = await restaurant();
    const steps = await onboardingSteps(h);
    // Konzept 7a: feste Reihenfolge, Reservation vor Speisekarte und Stripe; kein eigener Schritt «Online gehen»
    expect(steps.map((s) => s.key)).toEqual(["betrieb", "tische", "reservierung", "speisekarte", "zahlungen", "funktionen", "karte"]);
    expect(steps.filter((s) => s.required).map((s) => s.key)).toEqual(["betrieb", "tische", "reservierung", "speisekarte", "karte"]);
    expect(steps.find((s) => s.key === "tische")!.done).toBe(false);
    expect(await quickTables(h, 3, 4, "t")).toBe(3);
    expect(await quickTables(h, 4, 2, "t")).toBe(1); // «Tisch 1–3» gibt es schon
    expect((await listTables(h.id)).map((t) => `${t.name}:${t.seats}`)).toEqual(["Tisch 1:4", "Tisch 2:4", "Tisch 3:4", "Tisch 4:2"]);
    expect((await onboardingSteps(h)).find((s) => s.key === "tische")!.done).toBe(true);
    const problems = await goLiveProblems(h);
    expect(problems.some((p) => /Kurtaxe|Stripe/.test(p))).toBe(false);
  });

  it("Kasse braucht Restaurant und Rechnung; Ausschalten von Restaurant nimmt die Kasse mit", async () => {
    const { hotel } = await makeHotel();
    await applyModules(hotel.id, { pos: true }, "t");
    let rows = await moduleRows(hotel.id);
    expect(isOn(rows, "restaurant")).toBe(true);
    expect(isOn(rows, "invoicing")).toBe(true);
    await applyModules(hotel.id, { restaurant: false }, "t");
    rows = await moduleRows(hotel.id);
    expect(isOn(rows, "pos")).toBe(false);
  });

  it("Migration: Betriebe mit Kasse bekommen das Modul Restaurant", () => {
    const sql = readFileSync("db/migrations/0083_restaurant_kind.sql", "utf8");
    expect(sql).toMatch(/INSERT INTO hotel_modules[\s\S]*'restaurant'[\s\S]*module = 'pos' AND enabled/);
  });

  it("Öffnungszeiten: Ruhetag und Zeiträume begrenzen die Online-Zeiten; ungültige Eingabe abgelehnt", async () => {
    const { hotel } = await makeHotel();
    const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
    await db().insert(hotelModules).values({ hotelId: h.id, module: "restaurant", enabled: true });
    await saveSettings(h.id, { ...(await getSettings(h.id)), onlineEnabled: true, windows: [{ from: "11:30", to: "13:30" }, { from: "18:00", to: "21:00" }], leadHours: 0, horizonDays: 60 }, "t");
    const day = addDays(todayIn(h.timezone), 7);
    const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
    const hours: Record<string, { from: string; to: string }[]> = {};
    for (let d = 0; d < 7; d++) hours[String(d)] = [{ from: "18:00", to: "22:00" }];
    hours[String(wd)] = []; // Ruhetag
    await saveOpeningHours(h.id, hours, "t");
    expect((await slotsFor(h, day, 2)).filter((x) => x.ok)).toHaveLength(0);
    const next = addDays(day, 1);
    expect((await slotsFor(h, next, 2)).filter((x) => x.ok).map((x) => x.time)).toEqual(["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00"]);
    // andere Einstellungen bleiben beim Speichern der Reservation erhalten
    await saveSettings(h.id, { ...(await getSettings(h.id)), capacity: 30 }, "t");
    expect((await getSettings(h.id)).openingHours?.[String(wd)]).toEqual([]);
    await expect(saveOpeningHours(h.id, { "1": [{ from: "22:00", to: "18:00" }] }, "t")).rejects.toThrow(/Montag/);
    await saveOpeningHours(h.id, null, "t");
    expect((await slotsFor(h, day, 2)).filter((x) => x.ok).length).toBeGreaterThan(0);
    const ms = await db().select().from(hotelModules).where(and(eq(hotelModules.hotelId, h.id), eq(hotelModules.module, "pos")));
    expect(ms).toHaveLength(0); // Einstellungen speichern schaltet kein Modul
  });

  it("Selbst-Onboarding (7a): Reservation geht ohne Stripe live, Checkliste zeigt Offenes, Abschluss nach allen Pflichtschritten", async () => {
    const { goLiveRestaurant, diningChecklist, markSetupCompleteIfDone } = await import("../../src/services/onboarding");
    const { hotelMembers, users } = await import("../../src/db/schema");
    const { saveItem } = await import("../../src/services/pos");
    let h = await restaurant();
    const [m] = await db().select().from(hotelMembers).where(eq(hotelMembers.hotelId, h.id));
    await db().update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, m.userId));
    await db().update(hotels).set({ addressLine: "Dorfstrasse 1", postalCode: "9000", city: "St. Gallen", billingPaymentMethodId: "pm_x" }).where(eq(hotels.id, h.id));
    await quickTables(h, 2, 4, "t");
    await saveSettings(h.id, { ...(await getSettings(h.id)), onlineEnabled: true }, "t");
    [h] = await db().select().from(hotels).where(eq(hotels.id, h.id));
    await goLiveRestaurant(h, "t");
    [h] = await db().select().from(hotels).where(eq(hotels.id, h.id));
    expect(h.status).toBe("live");
    expect(h.stripeChargesEnabled).toBe(false); // ohne Stripe online
    let list = await diningChecklist(h);
    expect(list.find((c) => c.key === "reservierung")!.done).toBe(true);
    expect(list.find((c) => c.key === "speisekarte")!.done).toBe(false);
    await markSetupCompleteIfDone(h);
    [h] = await db().select().from(hotels).where(eq(hotels.id, h.id));
    expect(h.onboarding.completedAt).toBeUndefined(); // Speisekarte fehlt
    await saveItem(h.id, null, { category: "Essen", name: "Rösti", priceRappen: 2150, vatDineInBps: 810, vatTakeawayBps: 260 }, "t");
    await markSetupCompleteIfDone(h);
    [h] = await db().select().from(hotels).where(eq(hotels.id, h.id));
    expect(h.onboarding.completedAt).toBeTruthy();
    list = await diningChecklist(h);
    expect(list.map((c) => c.key)).toEqual(["betrieb", "tische", "reservierung", "speisekarte", "zahlungen", "bestellung", "karte", "domain"]);
  });
});
