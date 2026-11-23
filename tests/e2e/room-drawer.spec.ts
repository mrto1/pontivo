import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { seedRooms, listRooms } from "../../src/services/frontdesk";
import { hotelModules } from "../../src/db/schema";
import { makeHotel } from "../helpers";

/** Zimmerplan → Zimmer verwalten: Liste, Seitenleiste zum Ändern (Nummer, Etage, Sperre) und Löschen */
test("Zimmer verwalten: Zimmer in der Seitenleiste ändern, sperren, hinzufügen und löschen", async ({ page, context, baseURL }) => {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 3, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
  await db().insert(hotelModules).values({ hotelId: h.hotel.id, module: "frontdesk", enabled: true }).onConflictDoUpdate({ target: [hotelModules.hotelId, hotelModules.module], set: { enabled: true } });
  await seedRooms(h.hotel.id, h.rooms[0].roomType.id, "e2e");
  const email = `owner-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);

  await page.goto(`/admin/${h.hotel.id}/plan`);
  // Erklärtext hinter ⓘ: antippen öffnet, daneben tippen schliesst
  await page.getByRole("button", { name: "Wozu dient der Zimmerplan?" }).click();
  await expect(page.getByRole("region", { name: "Wozu dient der Zimmerplan?" })).toContainText("Der Zimmerplan ist optional");
  await page.locator("h2", { hasText: "Nicht zugewiesen" }).click();
  await expect(page.getByRole("region", { name: "Wozu dient der Zimmerplan?" })).toHaveCount(0);

  const manage = page.locator("section", { has: page.getByRole("heading", { name: "Zimmer verwalten" }) });
  await manage.getByRole("link", { name: "Zimmer 1 bearbeiten" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Zimmer 1" })).toBeVisible();
  await drawer.locator("input[name=number]").fill("101");
  await drawer.locator("input[name=floor]").fill("1. OG");
  await drawer.getByRole("checkbox").uncheck();
  await drawer.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(manage.getByRole("link", { name: "Zimmer 101 bearbeiten" })).toContainText("gesperrt");
  await expect(manage.getByRole("link", { name: "Zimmer 101 bearbeiten" })).toContainText("1. OG");

  // doppelte Nummer: Fehler, Seitenleiste bleibt offen
  await manage.getByRole("link", { name: "Zimmer 2 bearbeiten" }).click();
  await page.getByRole("dialog").locator("input[name=number]").fill("101");
  await page.getByRole("dialog").getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("dialog")).toContainText("gibt es schon");
  await page.getByRole("dialog").getByRole("link", { name: "Abbrechen" }).click();

  // löschen (mit Rückfrage)
  page.once("dialog", (d) => d.accept());
  await manage.getByRole("link", { name: "Zimmer 3 bearbeiten" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Zimmer löschen" }).click();
  await expect(manage.getByRole("link", { name: "Zimmer 3 bearbeiten" })).toHaveCount(0);
  expect((await listRooms(h.hotel.id)).map((r) => r.number).sort()).toEqual(["101", "2"]);

  // neues Zimmer; danach fehlt wieder eines → Hinweis mit Knopf
  await expect(manage.getByText("2 von 3 Zimmern angelegt")).toBeVisible();
  await manage.getByRole("link", { name: "+ Zimmer hinzufügen" }).click();
  await page.getByRole("dialog").locator("input[name=number]").fill("7");
  await page.getByRole("dialog").getByRole("button", { name: "Zimmer anlegen" }).click();
  await expect(manage.getByRole("link", { name: "Zimmer 7 bearbeiten" })).toBeVisible();
});
