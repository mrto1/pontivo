import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { hotels } from "../../src/db/schema";
import { makeHotel } from "../helpers";

const uid = () => Math.random().toString(36).slice(2, 8);
async function login(context: import("@playwright/test").BrowserContext, baseURL: string, hotelId: string, role: "owner" | "service") {
  const email = `area-${uid()}@example.ch`;
  await addMember(hotelId, email, role, "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL }]);
}

/** Zwei Bereiche (SPEC 20.1): Umschalter, Bereich folgt der Seite, geteilte Seiten bleiben, Hinweis in der Tagesliste */
test("Hotel mit Restaurant: Umschalter Hotel | Restaurant", async ({ page, context, baseURL }) => {
  const h = await makeHotel();
  await db().insert(hotelModules).values([{ hotelId: h.hotel.id, module: "restaurant", enabled: true }]).onConflictDoNothing();
  await login(context, baseURL!, h.hotel.id, "owner");
  const nav = page.locator(".admin-nav");

  await page.goto(`/mypontivo/${h.hotel.id}`);
  const sw = page.getByRole("group", { name: "Bereich wählen" });
  await expect(sw.getByRole("button", { name: /Hotel/ })).toHaveAttribute("aria-pressed", "true");
  await expect(nav.getByRole("link", { name: "Kalender" })).toBeVisible();
  await expect(page.getByTestId("dining-hint")).toContainText("Restaurant heute: 0 Reservierungen");

  await sw.getByRole("button", { name: /Restaurant/ }).click();
  await expect(page).toHaveURL(/\/restaurant\/heute$/, { timeout: 20_000 });
  await expect(nav.getByRole("link", { name: "Reservierungen" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Heute", level: 1 })).toBeVisible();

  // geteilte Seite bleibt im Bereich Gastronomie; Startseite führt zur Tagesübersicht
  await expect.poll(async () => (await context.cookies()).find((c) => c.name.startsWith("pv_area_"))?.value).toBe("dining");
  await page.goto(`/mypontivo/${h.hotel.id}/vouchers`);
  await expect(nav.getByRole("link", { name: "Reservierungen" })).toBeVisible();
  await page.goto(`/mypontivo/${h.hotel.id}`);
  await expect(page).toHaveURL(/\/restaurant\/heute$/);
  // Seite der Unterkunft wechselt den Bereich von selbst (z. B. Link aus einer Mail)
  await page.goto(`/mypontivo/${h.hotel.id}/bookings`);
  await expect(nav.getByRole("link", { name: "Kalender" })).toBeVisible();
  await expect(sw.getByRole("button", { name: /Hotel/ })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await context.cookies()).find((c) => c.name.startsWith("pv_area_"))?.value).toBe("lodging"); // gemerkt, sobald die Seite geladen ist
  await page.goto(`/mypontivo/${h.hotel.id}`);
  await expect(page.getByRole("heading", { name: "Tagesliste" })).toBeVisible();
});

test("Reines Restaurant: nur Gastronomie, kein Umschalter; Service landet in der Tagesübersicht", async ({ page, context, baseURL }) => {
  const { hotel } = await makeHotel({}, []);
  await db().update(hotels).set({ propertyType: "restaurant", status: "draft", onboarding: { startedAt: new Date().toISOString(), reminders: 0 } }).where(eq(hotels.id, hotel.id));
  await db().insert(hotelModules).values([{ hotelId: hotel.id, module: "restaurant", enabled: true }]).onConflictDoNothing();
  await login(context, baseURL!, hotel.id, "owner");
  await page.goto(`/mypontivo/${hotel.id}`);
  await expect(page).toHaveURL(/\/restaurant\/heute$/);
  await expect(page.getByRole("group", { name: "Bereich wählen" })).toHaveCount(0);
  await expect(page.locator(".admin-nav a")).toHaveText(["Heute", "Reservierungen", "Bestellungen", "Finanzen"]);
  await page.goto(`/mypontivo/${hotel.id}/einstellungen`);
  await expect(page.getByRole("link", { name: "Zimmer & Tarife" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Speisekarte" }).first()).toBeVisible();
  // Assistent mit Restaurant-Schritten
  await page.goto(`/mypontivo/${hotel.id}/einrichten?step=tische`);
  await page.getByLabel("Anzahl Tische").fill("6");
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await page.goto(`/mypontivo/${hotel.id}/einrichten?step=tische`); // Angaben fehlen noch, darum führt «weiter» zuerst dorthin
  await expect(page.getByText("6 Tische mit zusammen 24 Plätzen")).toBeVisible();

  const h2 = await makeHotel();
  await db().insert(hotelModules).values([{ hotelId: h2.hotel.id, module: "restaurant", enabled: true }]).onConflictDoNothing();
  await context.clearCookies();
  await login(context, baseURL!, h2.hotel.id, "service");
  await page.goto(`/mypontivo/${h2.hotel.id}`);
  await expect(page).toHaveURL(/\/restaurant\/heute$/);
  await expect(page.getByRole("group", { name: "Bereich wählen" })).toHaveCount(0);
});
