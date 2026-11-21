import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { users } from "../../src/db/schema";
import { addMember } from "../../src/services/settings";
import { setPasswordUnchecked } from "../../src/services/password";
import { makeHotel } from "../helpers";

/** Anmeldung mit E-Mail und Passwort (SPEC 19.43): Fehlerfall, Erfolg, Passwort ändern in «Profil & Sicherheit» */
test("Passwort-Login: falsches Passwort, richtiges Passwort, Passwort ändern", async ({ page }) => {
  const h = await makeHotel();
  const email = `pw-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await setPasswordUnchecked(u.id, "testtest");

  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Passwort vergessen/ })).toBeVisible();
  await page.fill("#email", email);
  await page.fill("#password", "falsch-falsch");
  await page.waitForTimeout(800); // Mindestzeit des Formular-Schutzes
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "stimmen nicht" })).toBeVisible();

  await page.fill("#email", email);
  await page.fill("#password", "testtest");
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin(/${h.hotel.id})?$`));

  // Passwort ändern: das alte muss stimmen
  await page.goto(`/admin/${h.hotel.id}/konto`);
  await page.waitForLoadState("networkidle");
  await page.fill("#pw-cur", "testtest");
  await page.getByTestId("pw-new").fill("neues-passwort");
  await page.getByTestId("pw-save").click();
  await expect(page.getByText("Passwort gespeichert.")).toBeVisible();
});
