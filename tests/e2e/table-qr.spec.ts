import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, hotels, tablePayments } from "../../src/db/schema";
import { addLines, createDevice, openOrder, saveItem, saveOption, saveOptionGroup, saveTable, setGroupItems } from "../../src/services/pos";
import { saveItemOnline } from "../../src/services/online-orders";
import { saveSettings } from "../../src/services/reservations";
import { ensureQrToken, saveReviewUrl } from "../../src/services/table-pay";
import { makeHotel } from "../helpers";

/** Zahlung am Tisch per QR (SPEC 19.55): Gast wählt, gibt Trinkgeld, zahlt und bewertet */
test("Tisch-QR: bezahlen mit Trinkgeld, Bewertung führt zu Google", async ({ page }) => {
  const m = await makeHotel();
  await db().update(hotels).set({ stripeAccountId: `acct_${crypto.randomUUID()}`, stripeChargesEnabled: true }).where(eq(hotels.id, m.hotel.id));
  const [h] = await db().select().from(hotels).where(eq(hotels.id, m.hotel.id));
  const item = await saveItem(h.id, null, { category: "Essen", name: "Rösti", priceRappen: 2000, vatDineInBps: 810, vatTakeawayBps: 260 }, "e2e");
  const dev = await createDevice(h.id, "K9", "Kasse", "e2e");
  const table = await saveTable(h.id, "Tisch 7", "e2e");
  const order = await openOrder(h.id, { tableId: table.id, deviceId: dev.id }, "e2e");
  await addLines(h, order.id, [{ itemId: item.id, quantity: 2 }], "e2e");
  await saveReviewUrl(h.id, "https://example.com/review", "e2e");
  const qr = await ensureQrToken(h.id, table.id);

  await page.goto(`/h/${h.slug}/de/am-tisch/${qr}`);
  await expect(page.getByRole("heading", { name: "Bezahlen am Tisch 7" })).toBeVisible();
  await page.getByLabel("Rösti").fill("1");
  await page.getByLabel("10 %").check();
  await page.getByRole("button", { name: /bezahlen/ }).click();
  await expect(page.getByRole("heading", { name: /Zahlung ist eingegangen/ })).toBeVisible();
  const [p] = await db().select().from(tablePayments).where(eq(tablePayments.hotelId, h.id));
  expect(p).toMatchObject({ itemsRappen: 2000, tipRappen: 200, status: "paid" });

  await page.getByTestId("feedback-form").getByRole("button", { name: "Senden" }).click();
  await expect(page.getByRole("link", { name: "Bei Google bewerten" })).toHaveAttribute("href", "https://example.com/review");
});

/** Bestellen am Tisch (SPEC 19.61): Gast wählt Artikel mit Garstufe, Bestellung erscheint danach als offener Posten */
test("Tisch-QR: Bestellen mit Garstufe, danach offen zum Bezahlen", async ({ page }) => {
  const m = await makeHotel();
  await db().update(hotels).set({ stripeAccountId: `acct_${crypto.randomUUID()}`, stripeChargesEnabled: true }).where(eq(hotels.id, m.hotel.id));
  await db().insert(hotelModules).values({ hotelId: m.hotel.id, module: "restaurant", enabled: true }).onConflictDoNothing();
  const [h] = await db().select().from(hotels).where(eq(hotels.id, m.hotel.id));
  await saveSettings(h.id, { onlineEnabled: true, windows: [{ from: "18:00", to: "20:00" }], durationMin: 90, maxParty: 12, capacity: 50, leadHours: 0, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 24, autoAssign: true, qrOrdering: true }, "e2e");
  const steak = await saveItem(h.id, null, { category: "Hauptgang", name: "Entrecôte", priceRappen: 4000, vatDineInBps: 810, vatTakeawayBps: 260 }, "e2e");
  await saveItemOnline(h.id, steak.id, { online: true, description: "", photoUrl: null, allergens: [] }, "e2e");
  const g = await saveOptionGroup(h.id, null, { name: "Garstufe", required: true, maxChoices: 1 }, "e2e");
  await saveOption(h.id, g.id, { name: "medium", priceRappen: 0 }, "e2e");
  const rare = await saveOption(h.id, g.id, { name: "rare", priceRappen: 0 }, "e2e");
  await setGroupItems(h.id, g.id, [steak.id], "e2e");
  const table = await saveTable(h.id, "Tisch 3", "e2e");
  const qr = await ensureQrToken(h.id, table.id);

  await page.goto(`/h/${h.slug}/de/am-tisch/${qr}`);
  const form = page.getByTestId("qr-order-form");
  await form.locator("summary").first().click();
  // Anzahl gesetzt, Garstufe vergessen: der Browser verlangt die Wahl, es wird nichts bestellt (keine stille Vorauswahl)
  await form.locator(`input[name="p_${steak.id}.0"]`).fill("1");
  await form.getByRole("button", { name: "Bestellen" }).click();
  await expect(page.getByTestId("qr-ordered")).toHaveCount(0);
  expect(await form.getByLabel("Entrecôte 1: Garstufe").evaluate((e: HTMLSelectElement) => e.validity.valueMissing)).toBe(true);
  await form.getByLabel("Entrecôte 1: Garstufe").selectOption(rare.id);
  await form.getByRole("button", { name: "Bestellen" }).click();
  await expect(page.getByTestId("qr-ordered")).toBeVisible();
  await expect(page.getByLabel("Entrecôte · rare")).toBeVisible();
});
