import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, rooms, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { addDays, todayIn } from "../../src/domain/dates";
import { makeHotel } from "../helpers";

/** Reinigung (SPEC 19.45): Statusfarben als Zähler, Schalter ohne ✓, Status nur für heute änderbar */
test("Reinigung: Zähler, Statusschalter heute, an anderen Tagen gesperrt", async ({ page, context, baseURL }) => {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 2, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
  await db().insert(hotelModules).values({ hotelId: h.hotel.id, module: "housekeeping", enabled: true }).onConflictDoNothing();
  await db().insert(rooms).values([{ hotelId: h.hotel.id, roomTypeId: h.rooms[0].roomType.id, number: "101", cleanStatus: "dirty" }, { hotelId: h.hotel.id, roomTypeId: h.rooms[0].roomType.id, number: "102", cleanStatus: "clean" }]);
  const email = `hk-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);

  await page.goto(`/admin/${h.hotel.id}/housekeeping`);
  const first = page.locator(".hk-card").first();
  await expect(page.locator(".hk-summary")).toContainText("Schmutzig");
  await expect(first.getByRole("button", { name: /✓/ })).toHaveCount(0);
  const before = await page.locator(".hk-card.dirty").count();
  await first.getByRole("button", { name: "Geprüft" }).click();
  await expect(page.locator(".hk-card.inspected")).toHaveCount(1);
  expect(before).toBe(1);
  await expect(page.locator(".hk-card.dirty")).toHaveCount(0);

  const tomorrow = addDays(todayIn("Europe/Zurich"), 1);
  await page.goto(`/admin/${h.hotel.id}/housekeeping?day=${tomorrow}`);
  await expect(page.getByText("nur für heute")).toBeVisible();
  await expect(page.locator(".hk-seg.ro").first()).toBeVisible();
});
