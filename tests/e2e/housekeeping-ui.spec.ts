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

  // Mangel melden / Auftrag in der Seitenleiste; Erklärung zu Sauber und Geprüft hinter ⓘ
  await page.getByRole("button", { name: "Was heisst Sauber und Geprüft?" }).click();
  await expect(page.getByRole("region", { name: "Was heisst Sauber und Geprüft?" })).toContainText("Zusätzlich");
  await page.keyboard.press("Escape");
  await first.getByRole("link", { name: "Mangel melden / Auftrag" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.locator("#hk-new").fill("Glühbirne defekt");
  await drawer.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(first).toContainText("Glühbirne defekt");

  // Bearbeiten zeigt den bisherigen Text; Erledigt nimmt ihn von der Karte, er bleibt unter «Erledigte Mängel»
  await first.getByRole("link", { name: "Bearbeiten / hinzufügen" }).click();
  const edit = page.getByRole("dialog").locator("form", { has: page.locator("textarea[defaultValue], textarea") }).filter({ hasText: "Erledigt" }).first();
  await expect(edit.locator("textarea")).toHaveValue("Glühbirne defekt");
  await edit.locator("textarea").fill("Glühbirne Nachttisch defekt");
  await edit.getByRole("button", { name: "Speichern" }).click();
  await expect(first).toContainText("Glühbirne Nachttisch defekt");
  await first.getByRole("button", { name: "Erledigt" }).click();
  await expect(first).not.toContainText("Glühbirne Nachttisch defekt");
  await first.getByRole("link", { name: "Mangel melden / Auftrag" }).click();
  await page.getByRole("dialog").getByText("Erledigte Mängel (1)").click();
  await expect(page.getByRole("dialog")).toContainText("Glühbirne Nachttisch defekt");
  await page.keyboard.press("Escape");

  const tomorrow = addDays(todayIn("Europe/Zurich"), 1);
  await page.goto(`/admin/${h.hotel.id}/housekeeping?day=${tomorrow}`);
  await expect(page.getByText("nur für heute")).toBeVisible();
  await expect(page.locator(".hk-seg.ro").first()).toBeVisible();
});
