import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { listResources } from "../../src/services/resources";
import { addDays, todayIn } from "../../src/domain/dates";
import { makeHotel } from "../helpers";

async function login(h: Awaited<ReturnType<typeof makeHotel>>, context: import("@playwright/test").BrowserContext, baseURL: string) {
  const email = `bk-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL }]);
}

test("Buchung erfassen öffnet als Seitenleiste auf der Buchungsliste; alte Adresse leitet dorthin", async ({ page, context, baseURL }) => {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 2, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
  await login(h, context, baseURL!);
  await page.goto(`/admin/${h.hotel.id}/bookings/new`);
  await expect(page).toHaveURL(/\/bookings\?neu=1/);
  await expect(page.getByRole("dialog")).toContainText("Buchung erfassen");
  await page.getByRole("link", { name: "Schliessen" }).last().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("link", { name: "+ Buchung erfassen" }).click();
  const d = page.getByRole("dialog");
  const today = todayIn(h.hotel.timezone);
  await d.locator("input[name=checkin]").fill(today);
  await d.locator("input[name=checkout]").fill(addDays(today, 1));
  await d.locator("input[name=firstName]").fill("Anna");
  await d.locator("input[name=lastName]").fill("Muster");
  await d.getByRole("button", { name: "Buchung erfassen" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${h.hotel.id}/bookings/[0-9a-f-]{36}`));
});

test("Angebote vor Ort: Stammdaten in den Einstellungen, Liste mit Seitenleiste, neues Angebot zuunterst", async ({ page, context, baseURL }) => {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
  await db().insert(hotelModules).values({ hotelId: h.hotel.id, module: "resources", enabled: true }).onConflictDoUpdate({ target: [hotelModules.hotelId, hotelModules.module], set: { enabled: true } });
  await login(h, context, baseURL!);
  await page.goto(`/admin/${h.hotel.id}/resources/angebote`);
  await page.getByRole("link", { name: "+ Neues Angebot" }).click();
  const d = page.getByRole("dialog");
  await d.locator("input[name=name]").fill("Sauna");
  await d.getByRole("button", { name: "Angebot anlegen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Sauna bearbeiten" }).click();
  await page.getByRole("dialog").locator("input[name=name]").fill("Sauna gross");
  await page.getByRole("dialog").getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("link", { name: "Sauna gross bearbeiten" })).toBeVisible();
  expect((await listResources(h.hotel.id)).map((r) => r.name)).toEqual(["Sauna gross"]);
  // Buchungsseite: nur noch Buchungen, mit Tageswechsel statt Datumsfeld
  await page.goto(`/admin/${h.hotel.id}/resources`);
  await expect(page.getByRole("group", { name: "Zeitraum verschieben" }).getByRole("link", { name: "Heute" })).toBeVisible();
  await expect(page.locator("input[name=capacity]")).toHaveCount(0);
});
