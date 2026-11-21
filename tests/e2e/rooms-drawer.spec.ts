import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { makeHotel } from "../helpers";

/** Zimmer & Tarife (SPEC 19.44): Karte anklicken öffnet die Seitenleiste mit Reitern; Speichern lässt sie offen; Escape schliesst */
test("Zimmertyp: Karte öffnet Seitenleiste, Name ändern, Tarif ansehen, Escape schliesst", async ({ page, context, baseURL }) => {
  const h = await makeHotel({}, [{ name: "Einzelzimmer", roomCount: 4, maxAdults: 1, maxChildren: 0, maxOccupancy: 1, basePriceRappen: 12000 }]);
  const email = `rooms-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);

  await page.goto(`/mypontivo/${h.hotel.id}/rooms`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: /Einzelzimmer bearbeiten/ }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("heading", { name: "Einzelzimmer" })).toBeVisible();
  for (const t of ["Grunddaten", "Fotos", "Tarife"]) await expect(dlg.getByRole("link", { name: new RegExp(`^${t}`) })).toBeVisible();

  await dlg.locator("input[name=name]").fill("Einzelzimmer Süd");
  await dlg.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("dialog").getByText("Zimmertyp gespeichert")).toBeVisible(); // Leiste bleibt offen
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Einzelzimmer Süd" })).toBeVisible();

  await page.getByRole("dialog").getByRole("link", { name: /^Tarife/ }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: /Tarif .* bearbeiten/ }).first()).toBeVisible();
  await page.getByRole("dialog").getByRole("link", { name: "+ Tarif hinzufügen" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Neuer Tarif" })).toBeVisible();

  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Einzelzimmer Süd bearbeiten/ })).toBeVisible();
});
