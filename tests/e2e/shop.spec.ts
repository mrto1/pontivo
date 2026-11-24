import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { seedRooms, listRooms } from "../../src/services/frontdesk";
import { saveGood } from "../../src/services/goods";
import { makeHotel } from "../helpers";

/** Shop & Lager: Ware anlegen (mit Minibar und Lager), Nachbestellen-Liste, Wareneingang */
test("Shop: Ware anlegen, Minibar und Nachbestellen", async ({ page, context, baseURL }) => {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
  await db().insert(hotelModules).values({ hotelId: h.hotel.id, module: "shop", enabled: true }).onConflictDoUpdate({ target: [hotelModules.hotelId, hotelModules.module], set: { enabled: true } });
  const email = `owner-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);

  await page.goto(`/admin/${h.hotel.id}/shop`);
  await page.getByRole("link", { name: "+ Neue Ware" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Name", { exact: true }).fill("Mineralwasser"); // Beschriftung ist mit dem Feld verknüpft
  await drawer.locator("input[name=price]").fill("4.50");
  await drawer.locator("input[name=minibar]").check();
  await drawer.locator("input[name=trackStock]").check();
  await drawer.locator("input[name=stock]").fill("2");
  await drawer.locator("input[name=minStock]").fill("5");
  await drawer.getByRole("button", { name: "Ware anlegen" }).click();
  await expect(page.getByText("Artikel gespeichert.")).toBeVisible();
  await expect(page.locator("#nachbestellen")).toContainText("Mineralwasser");
  await expect(page.getByRole("link", { name: "Mineralwasser bearbeiten" })).toContainText("Minibar 2");

  await page.getByRole("link", { name: "Mineralwasser bearbeiten" }).click();
  await page.getByRole("dialog").locator("input[name=delta]").fill("10");
  await page.getByRole("dialog").getByRole("button", { name: "Buchen" }).click();
  await expect(page.locator("#nachbestellen")).toHaveCount(0);
});

test("Minibar: Zählung erscheint in der Reinigung nur mit Minibar-Ware", async ({ page, context, baseURL }) => {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
  for (const module of ["shop", "housekeeping", "frontdesk"]) await db().insert(hotelModules).values({ hotelId: h.hotel.id, module, enabled: true }).onConflictDoUpdate({ target: [hotelModules.hotelId, hotelModules.module], set: { enabled: true } });
  await seedRooms(h.hotel.id, h.rooms[0].roomType.id, "e2e");
  const [room] = await listRooms(h.hotel.id);
  const email = `owner-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);
  await page.goto(`/admin/${h.hotel.id}/housekeeping?room=${room.id}`);
  await expect(page.getByRole("heading", { name: "Minibar zählen" })).toHaveCount(0);
  await saveGood(h.hotel.id, null, { name: "Cola", category: "", priceRappen: 500, vat: "standard", sellable: true, active: true, minibar: true, minibarPar: 3, trackStock: false, stock: 0, minStock: 0 }, "e2e", true);
  await page.goto(`/admin/${h.hotel.id}/housekeeping?room=${room.id}`);
  await expect(page.getByRole("heading", { name: "Minibar zählen" })).toBeVisible();
  await page.getByRole("button", { name: "Minibar buchen" }).click();
  await expect(page.getByText("Minibar vollständig.")).toBeVisible();
  await expect(page.locator("#nachfuellen")).toHaveCount(0);
});
