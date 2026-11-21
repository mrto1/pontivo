import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { setRestaurantPublic } from "../../src/services/platform-settings";

/** Öffentliche Seiten (SPEC 20.9): Dachmarke, Unterkünfte, Restaurant-Seite erst nach Freischaltung */
test("Startseite, Unterkünfte und Restaurant-Seite mit Freischaltung", async ({ page, context, baseURL }) => {
  await setRestaurantPublic(false, "e2e");
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Ihre Gäste direkt bei Ihnen. Ohne Umweg.", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Für Restaurants", exact: true })).toHaveCount(0);
    expect((await page.goto("/restaurant"))!.status()).toBe(404);
    await page.goto("/");
    await page.getByRole("link", { name: "Für Unterkünfte", exact: true }).click();
    await expect(page).toHaveURL(/\/unterkunft$/);
    await expect(page.locator("h1")).toBeVisible();

    // Plattform-Admin sieht den Entwurf und schaltet frei
    const email = `admin-${Math.random().toString(36).slice(2, 8)}@example.ch`;
    const [u] = await db().insert(users).values({ email, isPlatformAdmin: true }).returning();
    await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);
    await page.goto("/restaurant");
    await expect(page.getByRole("note")).toContainText("Entwurf");
    await page.goto("/admin/plattform/website");
    await page.getByRole("button", { name: "Restaurant-Seite freischalten" }).click();
    await expect(page.getByText("Restaurant-Seite ist jetzt öffentlich.")).toBeVisible();
    await context.clearCookies();

    await page.goto("/");
    await page.getByRole("link", { name: "Für Restaurants", exact: true }).click();
    await expect(page).toHaveURL(/\/restaurant$/);
    await expect(page.getByRole("heading", { name: /Website, Reservation, Bestellung und Kasse/, level: 1 })).toBeVisible();
    await expect(page.locator("#preise")).toContainText("CHF 29 pro Monat");
    await expect(page.locator("#preise")).toContainText("ohne Gebühr");
    await page.getByRole("link", { name: "Jetzt selbst einrichten" }).click();
    await expect(page).toHaveURL(/\/registrieren\?art=restaurant$/);
    await expect(page.getByRole("heading", { name: /Ihr Restaurant online/ })).toBeVisible();
    await expect(page.getByLabel("Restaurant / Café / Take-away")).toBeChecked();
    await db().delete(users).where(eq(users.id, u.id));
  } finally {
    await setRestaurantPublic(false, "e2e");
  }
});
