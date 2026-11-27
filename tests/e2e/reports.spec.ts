import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { makeHotel } from "../helpers";

/** Berichte (SPEC 19.46): Export-Karten mit ‹ Monat ›; Meldeschein-Karten nur mit der Funktion; Profilbild führt direkt zu «Mein Konto» */
test("Berichte: Karten je Funktion, Monat blättern, Profilbild direkt", async ({ page, context, baseURL }) => {
  const h = await makeHotel();
  const email = `rep-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);

  await page.goto(`/admin/${h.hotel.id}/berichte`);
  await expect(page.getByRole("heading", { name: "Berichte", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Gästeregister" })).toHaveCount(0); // Funktion aus
  const card = page.getByRole("region", { name: "Buchungsabrechnung" });
  const csv = card.getByRole("link", { name: "CSV für Excel" });
  const before = await csv.getAttribute("href");
  await card.getByRole("link", { name: "Zurück" }).click();
  expect(await csv.getAttribute("href")).not.toBe(before);

  await db().insert(hotelModules).values({ hotelId: h.hotel.id, module: "guests", enabled: true }).onConflictDoNothing();
  await page.reload();
  await expect(page.getByRole("region", { name: "Gästeregister" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Kurtaxe-Liste" })).toBeVisible();
  await page.goto(`/admin/${h.hotel.id}/guests`); // alte Adresse
  await expect(page).toHaveURL(/\/berichte$/);

  await page.locator(".avatar-link").click();
  await expect(page.getByRole("heading", { name: "Mein Konto" })).toBeVisible();
});

/** Restaurant (SPEC 19.48): Kassen-Artikel liegt im Zahnrad (Menü bleibt Einstellungen); CSV-Import von Artikeln und Tischen */
test("Restaurant: Zahnrad-Menü bleibt, CSV-Import Artikel und Tische", async ({ page, context, baseURL }) => {
  const h = await makeHotel();
  await db().insert(hotelModules).values([{ hotelId: h.hotel.id, module: "invoicing", enabled: true }, { hotelId: h.hotel.id, module: "restaurant", enabled: true }, { hotelId: h.hotel.id, module: "pos", enabled: true }]).onConflictDoNothing();
  const email = `pos-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);

  await page.goto(`/admin/${h.hotel.id}/restaurant/artikel`);
  await expect(page.getByRole("heading", { name: "Speisekarte", exact: true })).toBeVisible();
  await expect(page.locator(".settings-side")).toBeVisible(); // Zahnrad-Rahmen, nicht das Menü «Bestellungen»
  await expect(page.locator(".admin-nav a.active")).toHaveCount(0);

  await page.locator("#file").setInputFiles({ name: "artikel.csv", mimeType: "text/csv", buffer: Buffer.from("name;preis;kategorie\nKaffee;4.80;Getränke\nRösti;21.50;Essen\n") });
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByText("2 Artikel importiert")).toBeVisible();
  await page.locator("#file").setInputFiles({ name: "artikel.csv", mimeType: "text/csv", buffer: Buffer.from("name;preis\nTee;abc\n") });
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByText("Nicht importiert")).toBeVisible();
  // Tische importiert die Seite «Tischplan & Reservation online» (SPEC 20.1)
  await page.goto(`/admin/${h.hotel.id}/restaurant/tische`);
  await page.locator("#tfile").setInputFiles({ name: "tische.csv", mimeType: "text/csv", buffer: Buffer.from("name\n1\n2\n") });
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByText("2 Tische importiert")).toBeVisible();
});
