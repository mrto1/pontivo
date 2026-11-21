import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { makeHotel } from "../helpers";

/** Anmelden und Zugang zu myPontivo von der Plattform-Startseite aus; Name «Mein Konto» für die persönliche Seite. */
test("Startseite: Anmelden, angemeldet «Zu <Betrieb>», im Admin myPontivo und Mein Konto", async ({ page, context, baseURL }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Anmelden" }).first()).toHaveAttribute("href", "/mypontivo/login");

  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
  const email = `owner-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);

  await page.goto("/");
  const to = page.getByRole("link", { name: "myPontivo", exact: true }).first();
  await expect(to).toBeVisible();
  await to.click();
  await expect(page).toHaveURL(new RegExp(`/mypontivo/${h.hotel.id}`));
  await expect(page.locator(".admin-brand")).toContainText("myPontivo");
  await expect(page.locator(".admin-brand")).toContainText(h.hotel.name);
  // Oben rechts: Zahnrad (Inhaber) und Profilbild mit Menü «Mein Konto»
  await expect(page.getByRole("link", { name: "Einstellungen" }).first()).toBeVisible();
  await page.locator(".avatar-menu summary").click();
  await page.locator(".avatar-pop").getByRole("link", { name: "Profil & Sicherheit" }).click();
  await expect(page.getByRole("heading", { name: "Mein Konto" })).toBeVisible();
  // Zahnrad führt auf die Übersicht der drei Gruppen
  await page.getByRole("link", { name: "Einstellungen" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/mypontivo/${h.hotel.id}/einstellungen`));
  for (const g of ["Betrieb", "Verkauf", "Technik"]) await expect(page.locator("h2", { hasText: g })).toBeVisible();
});
