import { expect, test } from "@playwright/test";

/** Öffentliche Seiten (SPEC 20.9): Dachmarke, Unterkünfte, Restaurant-Seite */
test("Startseite, Unterkünfte- und Restaurant-Seite", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Direktbuchungen, Reservationen und Bestellungen für Schweizer Gastgeber.", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Für Unterkünfte", exact: true }).click();
  await expect(page).toHaveURL(/\/unterkunft$/);
  await expect(page.locator("h1")).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "Für Restaurants", exact: true }).click();
  await expect(page).toHaveURL(/\/restaurant$/);
  await expect(page.getByRole("heading", { name: /Website, Reservation, Bestellung und Kasse/, level: 1 })).toBeVisible();
  await expect(page.locator("#preise")).toContainText("CHF 29 pro Monat");
  await expect(page.locator("#preise")).toContainText("ohne Gebühr");
  await expect(page.locator("#preise")).toContainText("1.9 % pro Bestellung");
  await expect(page.getByTestId("order-offer")).toContainText("Sonderangebot: 3 Monate Online-Bestellung pauschal");
  await expect(page.getByTestId("order-offer")).toContainText("CHF 59 pro Monat");
  await page.getByRole("link", { name: "Jetzt loslegen" }).click();
  await expect(page).toHaveURL(/\/registrieren\?art=restaurant$/);
  await expect(page.getByRole("heading", { name: /Ihr Restaurant online/ })).toBeVisible();
  await expect(page.getByLabel("Restaurant / Café / Take-away")).toBeChecked();
  await expect(page.getByTestId("register-help")).toContainText("Gespräch vereinbaren");
});
