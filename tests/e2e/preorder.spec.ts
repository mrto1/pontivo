import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, hotels, posReservations } from "../../src/db/schema";
import { addDays, todayIn } from "../../src/domain/dates";
import { saveItem } from "../../src/services/pos";
import { saveItemOnline } from "../../src/services/online-orders";
import { saveSettings } from "../../src/services/reservations";
import { makeHotel } from "../helpers";

/** Vorbestellung (SPEC 19.57): Gast reserviert mit Vorbestellung und bezahlt vorab */
test("Reservierung mit Vorbestellung", async ({ page }) => {
  const m = await makeHotel();
  await db().update(hotels).set({ stripeAccountId: `acct_${crypto.randomUUID()}`, stripeChargesEnabled: true }).where(eq(hotels.id, m.hotel.id));
  await db().insert(hotelModules).values({ hotelId: m.hotel.id, module: "restaurant", enabled: true }).onConflictDoNothing();
  const [h] = await db().select().from(hotels).where(eq(hotels.id, m.hotel.id));
  await saveSettings(h.id, { onlineEnabled: true, windows: [{ from: "18:00", to: "20:00" }], durationMin: 90, maxParty: 12, capacity: 50, leadHours: 0, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 24, autoAssign: true, preorderEnabled: true, preorderRequiredFrom: 0 }, "e2e");
  const it = await saveItem(h.id, null, { category: "Vorspeise", name: "Randensuppe", priceRappen: 1200, vatDineInBps: 810, vatTakeawayBps: 260 }, "e2e");
  await saveItemOnline(h.id, it.id, { online: true, description: "", photoUrl: null, allergens: [] }, "e2e");
  const day = addDays(todayIn(h.timezone), 2);

  await page.goto(`/h/${h.slug}/de/tisch?date=${day}&party=6`);
  await expect(page.getByTestId("preorder")).toBeVisible();
  await page.getByLabel("Anzahl: Randensuppe").fill("6");
  await page.getByLabel("Name").fill("Gruppe Muster");
  await page.getByLabel("E-Mail").fill("gruppe@example.ch");
  await page.getByRole("button", { name: "Verbindlich reservieren" }).click();
  await expect(page.getByText("Gruppe Muster")).toBeVisible();
  const [r] = await db().select().from(posReservations).where(eq(posReservations.hotelId, h.id));
  expect(r).toMatchObject({ party: 6, preorderRappen: 7200, depositStatus: "paid", status: "confirmed" });
});
