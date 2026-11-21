import { afterAll, afterEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { deliveryFlags, emailOutbox, hotelModules, hotels, onlineOrders, posReceipts, smsOutbox } from "../../src/db/schema";
import { todayIn, zonedToUtc } from "../../src/domain/dates";
import { FakePaymentProvider } from "../../src/payments/fake";
import { setPaymentProvider } from "../../src/payments/provider";
import { openTickets, saveItem, saveOption, saveOptionGroup, setGroupItems } from "../../src/services/pos";
import { getSettings, saveOpeningHours } from "../../src/services/reservations";
import {
  acceptOrder, completeOrder, createOnlineOrder, heartbeat, notAccepted, onlineOrdersJob, orderFeesForMonth, orderReadiness, orderSettings, outForDelivery,
  pauseOrders, readyOrder, rejectOrder, saveOrderSettings, saveZone, screenOrders, setOrdersEnabled, startTestOrder, saveItemOnline, onlineMenu, onlineOrderingOn,
} from "../../src/services/online-orders";
import { makeHotel } from "../helpers";
import { setOrderFeeModel } from "../../src/services/platform-settings";

afterAll(closeDb);
afterEach(async () => { setPaymentProvider(null); await setOrderFeeModel("fixed", "t"); });

const allDay = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [{ from: "00:00", to: "23:59" }]]));

async function setup() {
  const { hotel } = await makeHotel({}, []);
  await db().update(hotels).set({ contactPhone: "079 123 45 67" }).where(eq(hotels.id, hotel.id));
  await db().insert(hotelModules).values({ hotelId: hotel.id, module: "restaurant", enabled: true });
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  const pizza = await saveItem(h.id, null, { category: "Pizza", name: "Margherita", priceRappen: 1800, vatDineInBps: 810, vatTakeawayBps: 260 }, "t");
  const g = await saveOptionGroup(h.id, null, { name: "Grösse", required: true, maxChoices: 1 }, "t");
  const big = await saveOption(h.id, g.id, { name: "gross", priceRappen: 400 }, "t");
  await setGroupItems(h.id, g.id, [pizza.id], "t");
  await saveOpeningHours(h.id, allDay, "t");
  await saveOrderSettings(h.id, { pickup: true, delivery: true, slotMinutes: 15, maxPerSlot: 5, deliveryPerSlot: 3, leadMin: 0, cutoffMin: 0, cashPickup: true, cashDelivery: true, cashMaxRappen: 10000, guestSms: true }, "t");
  const noon = zonedToUtc(todayIn(h.timezone), "12:00", h.timezone);
  return { h, pizza, big, noon };
}
const order = (pizzaId: string, optionIds: string[], extra: object = {}) => ({ kind: "pickup" as const, time: "asap", payment: "card" as const, name: "Gast", phone: "079 111 22 33", email: "gast@example.ch", language: "de", lines: [{ itemId: pizzaId, quantity: 2, optionIds, note: "scharf" }], ...extra });

describe("Online-Bestellung (SPEC 20.4)", () => {
  it("Live-Gang erst nach Probebestellung; Probe empfangen, annehmen, bereit → bestanden, ohne Bon", async () => {
    const { h } = await setup();
    expect((await orderReadiness(h)).map((p) => p.key)).toEqual(["zones", "test"]);
    await expect(setOrdersEnabled(h, true, "t")).rejects.toThrow(/Probebestellung/);
    await saveZone(h.id, null, { name: "Stadt", postalCodes: ["9000"], minOrderRappen: 2000, feeRappen: 500, freeFromRappen: 6000, extraMinutes: 20 }, "t");
    const t = await startTestOrder(h, "t");
    expect(t).toMatchObject({ status: "new", isTest: true, feeRappen: 0 });
    expect((await screenOrders(h.id)).open.map((o) => o.id)).toContain(t.id);
    await acceptOrder(h, t.id, 0, "t");
    await readyOrder(h, t.id, "t");
    expect((await orderSettings(h.id)).testPassedAt).toBeTruthy();
    expect(await db().select().from(posReceipts).where(eq(posReceipts.hotelId, h.id))).toHaveLength(0);
    await expect(setOrdersEnabled(h, true, "t")).rejects.toThrow(/Pilotbedingungen/);
    await setOrdersEnabled(h, true, "t", { acceptTerms: true });
    expect((await orderSettings(h.id)).enabled).toBe(true);
  });

  it("Karte: bezahlt → neu, Annahme legt Küche und Bon an (Take-away), bereit, abgeholt; Gebühr 1,9 %", async () => {
    await setOrderFeeModel("percent", "t"); // Ziel-Modell nach positiver ESTV-Auskunft
    const { h, pizza, big, noon } = await setup();
    await saveZone(h.id, null, { name: "Stadt", postalCodes: ["9000"], minOrderRappen: 0, feeRappen: 0, freeFromRappen: null, extraMinutes: 0 }, "t");
    await db().insert((await import("../../src/db/schema")).onlineOrderSettings).values({ hotelId: h.id }).onConflictDoNothing();
    await db().update((await import("../../src/db/schema")).onlineOrderSettings).set({ enabled: true, testPassedAt: new Date() }).where(eq((await import("../../src/db/schema")).onlineOrderSettings.hotelId, h.id));
    await expect(createOnlineOrder(h, order(pizza.id, []), { now: noon })).rejects.toThrow(/Grösse/);
    const { order: o } = await createOnlineOrder(h, order(pizza.id, [big.id]), { now: noon });
    expect(o).toMatchObject({ status: "new", number: "A-001", subtotalRappen: 4400, totalRappen: 4400, feeRappen: 84 });
    expect(o.items[0]).toMatchObject({ description: "Margherita · gross · scharf", unitPriceRappen: 2200, vatBps: 0 });
    const mails = await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, h.id), eq(emailOutbox.template, "order_received")));
    expect(mails).toHaveLength(1);
    const a = await acceptOrder(h, o.id, 10, "t");
    expect(a.status).toBe("accepted");
    expect(a.posOrderId).toBeTruthy();
    expect(a.receiptId).toBeTruthy();
    const kitchen = await openTickets(h.id, "kitchen");
    expect(kitchen[0].label).toMatch(/^Abholung \d\d:\d\d · A-001$/);
    expect(kitchen[0].lines[0]).toMatchObject({ quantity: 2, mode: "takeaway" });
    await readyOrder(h, o.id, "t");
    expect(await openTickets(h.id, "kitchen")).toHaveLength(0);
    expect(await db().select().from(smsOutbox).where(eq(smsOutbox.ref, `order-ready:${o.id}`))).toHaveLength(1); // Gast-SMS eingeschaltet
    await completeOrder(h, o.id, "t");
    const fees = await orderFeesForMonth(h, todayIn(h.timezone).slice(0, 7));
    expect(fees).toEqual({ total: 84, uncollected: 0 });
  });

  it("Bar und Lieferung: Mindestwert, Liefergebühr als Bonzeile, Fahrer, Bon erst bei Übergabe, nicht angenommen markiert", async () => {
    await setOrderFeeModel("percent", "t"); // Ziel-Modell nach positiver ESTV-Auskunft
    const { h, pizza, big, noon } = await setup();
    const { onlineOrderSettings } = await import("../../src/db/schema");
    await db().insert(onlineOrderSettings).values({ hotelId: h.id, enabled: true, testPassedAt: new Date(), delivery: true, cashDelivery: true }).onConflictDoUpdate({ target: onlineOrderSettings.hotelId, set: { enabled: true, testPassedAt: new Date() } });
    await saveZone(h.id, null, { name: "Stadt", postalCodes: ["9000"], minOrderRappen: 5000, feeRappen: 500, freeFromRappen: 8000, extraMinutes: 20 }, "t");
    const addr = { street: "Bahnhofstrasse", houseNo: "1", postalCode: "9000", city: "St. Gallen" };
    await expect(createOnlineOrder(h, order(pizza.id, [big.id], { kind: "delivery", payment: "cash", address: { ...addr, postalCode: "8000" } }), { now: noon })).rejects.toThrow(/nicht nach 8000/);
    await expect(createOnlineOrder(h, order(pizza.id, [big.id], { kind: "delivery", payment: "cash", address: addr }), { now: noon })).rejects.toThrow(/Mindestbestellwert/);
    const big3 = { ...order(pizza.id, [big.id]), kind: "delivery" as const, payment: "cash" as const, address: addr, lines: [{ itemId: pizza.id, quantity: 3, optionIds: [big.id], note: "" }] };
    const { order: o } = await createOnlineOrder(h, big3, { now: noon });
    expect(o).toMatchObject({ status: "new", subtotalRappen: 6600, deliveryFeeRappen: 500, totalRappen: 7100 });
    await acceptOrder(h, o.id, 0, "t");
    expect((await db().select().from(posReceipts).where(eq(posReceipts.hotelId, h.id)))).toHaveLength(0); // bar: noch kein Bon
    await outForDelivery(h, o.id, "Marco", "t");
    await completeOrder(h, o.id, "t");
    const [r] = await db().select().from(posReceipts).where(eq(posReceipts.hotelId, h.id));
    expect(r.totalRappen).toBe(7100);
    expect(r.items.map((x) => x.description)).toContain("Liefergebühr");
    expect(await orderFeesForMonth(h, todayIn(h.timezone).slice(0, 7))).toEqual({ total: 135, uncollected: 135 });
    // zweite Lieferung nicht angenommen → Adresse markiert
    const { order: o2 } = await createOnlineOrder(h, big3, { now: noon });
    await acceptOrder(h, o2.id, 0, "t");
    await notAccepted(h, o2.id, "t");
    expect(await db().select().from(deliveryFlags).where(eq(deliveryFlags.hotelId, h.id))).toHaveLength(1);
    const { order: o3 } = await createOnlineOrder(h, big3, { now: noon });
    expect((await screenOrders(h.id)).flagged.size).toBe(1);
    await rejectOrder(h, o3.id, "Zu viel los", "t");
  });

  it("Absicherung: Alarm nach 5 Min. (SMS), Storno mit Rückerstattung nach 10 Min.; Pause; Herzschlag pausiert und setzt fort", async () => {
    const { h, pizza, big, noon } = await setup();
    const { onlineOrderSettings } = await import("../../src/db/schema");
    await db().insert(onlineOrderSettings).values({ hotelId: h.id, enabled: true, testPassedAt: new Date() }).onConflictDoUpdate({ target: onlineOrderSettings.hotelId, set: { enabled: true, testPassedAt: new Date() } });
    const fp = new FakePaymentProvider(); setPaymentProvider(fp);
    const { order: o } = await createOnlineOrder(h, order(pizza.id, [big.id]), { now: noon });
    await db().update(onlineOrders).set({ createdAt: new Date(Date.now() - 6 * 60_000) }).where(eq(onlineOrders.id, o.id));
    await onlineOrdersJob();
    expect(await db().select().from(smsOutbox).where(eq(smsOutbox.ref, `order-alarm:${o.id}`))).toHaveLength(1);
    await onlineOrdersJob(); // nur einmal
    expect(await db().select().from(smsOutbox).where(eq(smsOutbox.ref, `order-alarm:${o.id}`))).toHaveLength(1);
    await db().update(onlineOrders).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(onlineOrders.id, o.id));
    await onlineOrdersJob();
    const [x] = await db().select().from(onlineOrders).where(eq(onlineOrders.id, o.id));
    expect(x.status).toBe("expired");
    expect(x.refundedAt).toBeTruthy();
    expect(fp.refunds[0]).toMatchObject({ amountRappen: o.totalRappen });
    // Pause von Hand
    await pauseOrders(h, 30, "t");
    await expect(createOnlineOrder(h, order(pizza.id, [big.id]), { now: noon })).rejects.toThrow(/keine Online-Bestellungen/);
    await pauseOrders(h, 0, "t");
    // Herzschlag: offen (ganzer Tag), kein Gerät → automatische Pause; Gerät meldet sich → weiter
    const r = await onlineOrdersJob();
    expect(r.paused).toBeGreaterThanOrEqual(1);
    expect((await orderSettings(h.id)).autoPaused).toBe(true);
    await heartbeat(h.id, "tablet-kueche-01", { battery: 80, charging: true, soundOk: true });
    expect((await orderSettings(h.id)).autoPaused).toBe(false);
    await onlineOrdersJob();
    expect((await orderSettings(h.id)).autoPaused).toBe(false);
    void getSettings;
  });

  it("Artikel online: Beschreibung, nur Website-Fotos, Allergene aus der festen Liste; ausgeschaltet nicht im Menü; Checkliste", async () => {
    const { h, pizza } = await setup();
    await saveItemOnline(h.id, pizza.id, { online: true, description: "  Tomaten,   Mozzarella ", photoUrl: "https://fremd.example/x.jpg", allergens: ["milk", "gluten", "erfunden"] }, "t");
    let menu = await onlineMenu(h.id);
    expect(menu[0]).toMatchObject({ description: "Tomaten, Mozzarella", photoUrl: null, allergens: ["gluten", "milk"] });
    await saveItemOnline(h.id, pizza.id, { online: true, description: "", photoUrl: "/media/abc/pizza.jpg", allergens: [] }, "t");
    expect((await onlineMenu(h.id))[0].photoUrl).toBe("/media/abc/pizza.jpg");
    await saveItemOnline(h.id, pizza.id, { online: false, description: "", photoUrl: null, allergens: [] }, "t");
    menu = await onlineMenu(h.id);
    expect(menu).toHaveLength(0);
    expect((await orderReadiness(h)).map((p) => p.key)).toContain("items");
    expect(await onlineOrderingOn(h.id)).toBe(false);
    const { diningChecklist } = await import("../../src/services/onboarding");
    const item = (await diningChecklist(h)).find((c) => c.key === "bestellung")!;
    expect(item.done).toBe(false);
    expect(item.hint).toMatch(/online bestellbar/);
  });
});

describe("Ohne Modul Kasse (SPEC 20.8)", () => {
  it("Online-Verkäufe je Tag aus den Bons, Buchungsliste mit Sammelbeleg ONL", async () => {
    const { h, pizza, big, noon } = await setup();
    const S = await import("../../src/db/schema");
    await db().insert(S.onlineOrderSettings).values({ hotelId: h.id }).onConflictDoNothing();
    await db().update(S.onlineOrderSettings).set({ enabled: true, testPassedAt: new Date() }).where(eq(S.onlineOrderSettings.hotelId, h.id));
    const { order: card } = await createOnlineOrder(h, order(pizza.id, [big.id]), { now: noon });
    await acceptOrder(h, card.id, 0, "t");
    const { order: cash } = await createOnlineOrder(h, order(pizza.id, [big.id], { payment: "cash" }), { now: noon });
    await acceptOrder(h, cash.id, 0, "t");
    await completeOrder(h, cash.id, "t");
    const { onlineSalesDays } = await import("../../src/services/online-sales");
    const day = todayIn(h.timezone);
    const days = await onlineSalesDays(h, day, day);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ count: 2, totalRappen: 8800, cardRappen: 4400, cashRappen: 4400 });
    expect(days[0].feeRappen).toBe(card.feeRappen + cash.feeRappen);
    const { journalFor } = await import("../../src/services/accounting-export");
    const j = await journalFor(h, day, day);
    expect(j.some((x) => x.doc === `ONL-${day}`)).toBe(true);
    expect(j.filter((x) => x.ref === `ONL-${day}`).length).toBeGreaterThanOrEqual(3);
  });

  it("Preismodell vorerst fest (SPEC 20.4): keine Gebühr pro Bestellung, CHF 59 pro Monat, sobald eingeschaltet", async () => {
    const { h, pizza, big, noon } = await setup();
    const S = await import("../../src/db/schema");
    const { orderModuleFee } = await import("../../src/services/online-orders");
    const month = todayIn(h.timezone).slice(0, 7);
    expect(await orderModuleFee(h, month)).toBe(0); // nicht eingeschaltet, keine Bestellungen
    await db().insert(S.onlineOrderSettings).values({ hotelId: h.id }).onConflictDoNothing();
    await db().update(S.onlineOrderSettings).set({ enabled: true, testPassedAt: new Date() }).where(eq(S.onlineOrderSettings.hotelId, h.id));
    const { order: o } = await createOnlineOrder(h, order(pizza.id, [big.id]), { now: noon });
    expect(o.feeRappen).toBe(0);
    expect(await orderModuleFee(h, month)).toBe(5900);
    await setOrderFeeModel("percent", "t");
    expect(await orderModuleFee(h, month)).toBe(0);
  });

  it("Sonderangebot und Pilotbetriebe: Start beim ersten Einschalten, die ersten 10 mit Kostendach CHF 149", async () => {
    const S = await import("../../src/db/schema");
    const { orderModuleFee, pilotSlotsLeft, setOrderPilot } = await import("../../src/services/online-orders");
    const { introUntil, pilotUntilFor, PILOT_SLOTS } = await import("../../src/domain/order-fee");
    const { PILOT_TERMS_VERSION } = await import("../../src/legal/pilot-terms");
    await db().update(S.onlineOrderSettings).set({ pilotUntil: null }); // Plätze frei (Tests laufen nacheinander)
    const { h, pizza, big, noon } = await setup();
    await saveZone(h.id, null, { name: "Stadt", postalCodes: ["9000"], minOrderRappen: 0, feeRappen: 0, freeFromRappen: null, extraMinutes: 0 }, "t");
    await db().insert(S.onlineOrderSettings).values({ hotelId: h.id }).onConflictDoNothing();
    await db().update(S.onlineOrderSettings).set({ testPassedAt: new Date() }).where(eq(S.onlineOrderSettings.hotelId, h.id));
    await setOrdersEnabled(h, true, "t", { acceptTerms: true });
    const today = todayIn(h.timezone);
    const cfg = await orderSettings(h.id);
    expect(cfg).toMatchObject({ startedOn: today, pilotUntil: pilotUntilFor(today), termsVersion: PILOT_TERMS_VERSION });
    expect(cfg.termsAcceptedAt).toBeTruthy();
    expect(await pilotSlotsLeft()).toBe(PILOT_SLOTS - 1);
    // Aus- und wieder einschalten ändert den Start nicht
    await setOrdersEnabled(h, false, "t");
    await setOrdersEnabled(h, true, "t");
    expect((await orderSettings(h.id)).startedOn).toBe(today);

    await setOrderFeeModel("percent", "t");
    const month = today.slice(0, 7);
    const { order: o1 } = await createOnlineOrder(h, order(pizza.id, [big.id]), { now: noon });
    expect(o1.feeRappen).toBe(0); // Sonderangebot
    expect(await orderModuleFee(h, month)).toBe(5900);

    // Nach dem Sonderangebot: 1,9 %, gedeckelt auf CHF 149 im Monat
    const after = introUntil(today);
    await db().update(S.onlineOrderSettings).set({ startedOn: "2020-01-01", pilotUntil: "2099-01-01" }).where(eq(S.onlineOrderSettings.hotelId, h.id));
    expect(after > today).toBe(true);
    expect(await orderModuleFee(h, month)).toBe(0);
    const { order: o2 } = await createOnlineOrder(h, order(pizza.id, [big.id]), { now: noon });
    expect(o2.feeRappen).toBe(84);
    await db().update(S.onlineOrders).set({ feeRappen: 14_880 }).where(eq(S.onlineOrders.id, o2.id)); // Monat fast am Dach
    const { order: o3 } = await createOnlineOrder(h, order(pizza.id, [big.id]), { now: noon });
    expect(o3.feeRappen).toBe(20);
    const { order: o4 } = await createOnlineOrder(h, order(pizza.id, [big.id]), { now: noon });
    expect(o4.feeRappen).toBe(0);

    // Plätze: nach 10 vergeben keiner mehr; entziehen gibt frei
    for (let i = 0; i < PILOT_SLOTS - 1; i++) {
      const { hotel: x } = await makeHotel({}, []);
      await db().insert(S.onlineOrderSettings).values({ hotelId: x.id, startedOn: "2020-01-01", pilotUntil: "2099-01-01" });
    }
    expect(await pilotSlotsLeft()).toBe(0);
    const { h: h2 } = await setup();
    await db().insert(S.onlineOrderSettings).values({ hotelId: h2.id }).onConflictDoNothing();
    await db().update(S.onlineOrderSettings).set({ testPassedAt: new Date() }).where(eq(S.onlineOrderSettings.hotelId, h2.id));
    await saveZone(h2.id, null, { name: "Stadt", postalCodes: ["9000"], minOrderRappen: 0, feeRappen: 0, freeFromRappen: null, extraMinutes: 0 }, "t");
    await setOrdersEnabled(h2, true, "t", { acceptTerms: true });
    expect(await orderSettings(h2.id)).toMatchObject({ startedOn: todayIn(h2.timezone), pilotUntil: null });
    await expect(setOrderPilot(h2.id, true, "t")).rejects.toThrow(/Pilotplätze/);
    await setOrderPilot(h.id, false, "t");
    await setOrderPilot(h2.id, true, "t");
    expect((await orderSettings(h2.id)).pilotUntil).toBe(pilotUntilFor(todayIn(h2.timezone)));
    await db().update(S.onlineOrderSettings).set({ pilotUntil: null });
  });

  it("Hinweis 30 Tage vor Ende des Sonderangebots: nur im Modell 1,9 %, einmal", async () => {
    const S = await import("../../src/db/schema");
    const { introNoticeJob } = await import("../../src/services/online-orders");
    const { h } = await setup();
    // Start 01.02.2027 → Sonderangebot bis 30.04.2027; am 10.04. liegt das Ende weniger als 30 Tage entfernt
    const now = new Date("2027-04-10T08:00:00Z");
    await db().insert(S.onlineOrderSettings).values({ hotelId: h.id, startedOn: "2027-02-01", pilotUntil: "2028-02-01", enabled: true }).onConflictDoUpdate({ target: S.onlineOrderSettings.hotelId, set: { startedOn: "2027-02-01", pilotUntil: "2028-02-01" } });
    await db().update(S.onlineOrderSettings).set({ introNoticeAt: now }).where(and(sql`started_on IS NOT NULL`, sql`hotel_id <> ${h.id}`)); // andere Betriebe aus früheren Tests nicht anschreiben
    expect(await introNoticeJob(now)).toBe(0); // Modell «fixed»: Pauschale läuft weiter
    await setOrderFeeModel("percent", "t");
    expect(await introNoticeJob(now)).toBe(1);
    expect(await introNoticeJob(now)).toBe(0);
    const [m] = await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, h.id), eq(emailOutbox.template, "host_order_intro_ending")));
    expect(m.data).toMatchObject({ last: "2027-04-30", from: "2027-05-01", pilotUntil: "2028-01-31" });
  });
});
