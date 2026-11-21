import { describe, expect, it } from "vitest";
import { acceptsOrders, addressKey, cleanAllergens, deliveryFee, goLiveProblems, openNow, orderNumber, orderSlots, parsePostalCodes, zoneFor } from "../../src/domain/online-order";
import { normalizePhone } from "../../src/integrations/sms/aspsms";

const hours = { "0": [], "1": [{ from: "11:00", to: "14:00" }, { from: "17:00", to: "21:00" }], "2": [{ from: "11:00", to: "14:00" }], "3": [], "4": [], "5": [], "6": [] };
const base = { openingHours: hours, slotMinutes: 15, leadMin: 20, cutoffMin: 15, capacity: 2, taken: new Map<string, number>() };

describe("Online-Bestellung: Logik (SPEC 20.4/20.5)", () => {
  it("Zeitfenster nach Öffnungszeit, Vorlauf, Bestellschluss und Kapazität", () => {
    // 2026-11-23 ist ein Montag
    const s = orderSlots({ ...base, day: "2026-11-23", now: { day: "2026-11-23", minutes: 12 * 60 + 50 } });
    expect(s.map((x) => x.time).slice(0, 5)).toEqual(["13:15", "13:30", "13:45", "17:00", "17:15"]);
    expect(s).toHaveLength(3 + 16);
    expect(s.at(-1)!.time).toBe("20:45");
    const full = orderSlots({ ...base, day: "2026-11-23", now: { day: "2026-11-23", minutes: 600 }, taken: new Map([["11:00", 2]]) });
    expect(full.find((x) => x.time === "11:00")!.ok).toBe(false);
    expect(full.find((x) => x.time === "11:15")!.ok).toBe(true);
    // Ruhetag, keine Öffnungszeiten, Vergangenheit
    expect(orderSlots({ ...base, day: "2026-11-22", now: { day: "2026-11-22", minutes: 600 } })).toEqual([]);
    expect(orderSlots({ ...base, openingHours: null, day: "2026-11-23", now: { day: "2026-11-23", minutes: 600 } })).toEqual([]);
    // Lieferung: Zusatzminuten verschieben das Fenster
    const d = orderSlots({ ...base, extraMin: 30, day: "2026-11-24", now: { day: "2026-11-23", minutes: 0 } });
    expect(d[0].time).toBe("11:30");
    expect(d.at(-1)!.time).toBe("14:15");
  });
  it("offen jetzt, Pause, Live-Gang-Prüfung", () => {
    expect(openNow(hours, { day: "2026-11-23", minutes: 12 * 60 })).toBe(true);
    expect(openNow(hours, { day: "2026-11-23", minutes: 15 * 60 })).toBe(false);
    expect(openNow(null, { day: "2026-11-23", minutes: 12 * 60 })).toBe(false);
    const now = new Date("2026-11-23T12:00:00Z");
    expect(acceptsOrders({ enabled: true, pausedUntil: null, autoPaused: false }, now)).toBe(true);
    expect(acceptsOrders({ enabled: true, pausedUntil: new Date("2026-11-23T12:30:00Z"), autoPaused: false }, now)).toBe(false);
    expect(acceptsOrders({ enabled: true, pausedUntil: new Date("2026-11-23T11:30:00Z"), autoPaused: false }, now)).toBe(true);
    expect(acceptsOrders({ enabled: true, pausedUntil: null, autoPaused: true }, now)).toBe(false);
    expect(goLiveProblems({ hasOpeningHours: true, onlineItems: 3, stripeReady: true, testPassed: true, pickup: true, delivery: false, activeZones: 0 })).toEqual([]);
    expect(goLiveProblems({ hasOpeningHours: false, onlineItems: 0, stripeReady: false, testPassed: false, pickup: false, delivery: true, activeZones: 0 }).map((p) => p.key)).toEqual(["hours", "items", "zones", "stripe", "test"]);
  });
  it("Liefergebiet, Gebühr, PLZ-Liste, Adresse, Nummer, Allergene, Telefon", () => {
    const zones = [{ id: "a", name: "Stadt", postalCodes: ["9000", "9008"], minOrderRappen: 2000, feeRappen: 500, freeFromRappen: 5000, extraMinutes: 20, active: true }, { id: "b", name: "Alt", postalCodes: ["9010"], minOrderRappen: 0, feeRappen: 0, freeFromRappen: null, extraMinutes: 0, active: false }];
    expect(zoneFor(zones, " 9008 ")!.id).toBe("a");
    expect(zoneFor(zones, "9010")).toBeNull();
    expect(deliveryFee(zones[0], 4999)).toBe(500);
    expect(deliveryFee(zones[0], 5000)).toBe(0);
    expect(parsePostalCodes("9000, 9008 9000")).toEqual(["9000", "9008"]);
    expect(parsePostalCodes("90000")).toBeNull();
    expect(addressKey("Bahnhofstrasse", "12a", "9000")).toBe(addressKey("Bahnhofstr.", "12 A", "9000"));
    expect(orderNumber(7)).toBe("A-007");
    expect(cleanAllergens(["milk", "x", "gluten"])).toEqual(["gluten", "milk"]);
    expect(normalizePhone("079 123 45 67")).toBe("+41791234567");
    expect(normalizePhone("0041 79 123 45 67")).toBe("+41791234567");
    expect(normalizePhone("123")).toBeNull();
  });
});

describe("Gästeseite: Adresssuche und Warenkorb (SPEC 20.4/20.5)", () => {
  it("Label von geo.admin.ch in Felder zerlegen", async () => {
    const { parseLabel } = await import("../../components/public/OrderCart");
    expect(parseLabel("Bahnhofstrasse 1a <b>9000 St. Gallen</b>")).toEqual({ label: "Bahnhofstrasse 1a 9000 St. Gallen", street: "Bahnhofstrasse", houseNo: "1a", postalCode: "9000", city: "St. Gallen" });
    expect(parseLabel("Rue de la Gare 12 <b>1003 Lausanne</b>")?.street).toBe("Rue de la Gare");
    expect(parseLabel("<b>9000 St. Gallen</b>")).toBeNull();
  });
  it("Warenkorb aus dem Browser nur in gültiger Form", async () => {
    const { parseCart } = await import("../../components/public/order-actions");
    const id = "11111111-1111-4111-8111-111111111111";
    expect(await parseCart(JSON.stringify([{ itemId: id, quantity: 2, optionIds: [id], note: "ohne Zwiebeln" }]))).toEqual([{ itemId: id, quantity: 2, optionIds: [id], note: "ohne Zwiebeln" }]);
    expect(await parseCart("kein json")).toBeNull();
    expect(await parseCart(JSON.stringify([{ itemId: "x", quantity: 1, optionIds: [] }]))).toBeNull();
    expect(await parseCart(JSON.stringify([{ itemId: id, quantity: 1, optionIds: ["'; drop"] }]))).toBeNull();
    expect(await parseCart(JSON.stringify(Array(51).fill({ itemId: id, quantity: 1, optionIds: [] })))).toBeNull();
  });
});
