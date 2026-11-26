import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotels, tablePayments } from "../../src/db/schema";
import { addLines, createDevice, openOrder, saveItem, saveTable } from "../../src/services/pos";
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
