import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, hotels, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { createApiKey } from "../../src/services/posbridge";
import { makeHotel } from "../helpers";

/** R6 (SPEC 20.10): Pächter verbindet seine Kasse mit dem Hotel */
test("Restaurant verbindet sich mit dem Schlüssel des Hotels", async ({ page, context, baseURL }) => {
  const a = await makeHotel();
  await db().insert(hotelModules).values([{ hotelId: a.hotel.id, module: "posbridge", enabled: true }, { hotelId: a.hotel.id, module: "invoicing", enabled: true }]).onConflictDoNothing();
  const { key } = await createApiKey(a.hotel.id, "Pächter", "e2e");
  const r = await makeHotel({}, []);
  await db().update(hotels).set({ propertyType: "restaurant" }).where(eq(hotels.id, r.hotel.id));
  await db().insert(hotelModules).values([{ hotelId: r.hotel.id, module: "restaurant", enabled: true }, { hotelId: r.hotel.id, module: "pos", enabled: true }, { hotelId: r.hotel.id, module: "invoicing", enabled: true }]).onConflictDoNothing();
  const email = `link-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(r.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);

  await page.goto(`/mypontivo/${r.hotel.id}/restaurant/geraete`);
  const box = page.getByTestId("room-link");
  await box.getByLabel("Schlüssel des Hotels").fill("pnt_falsch");
  await box.getByRole("button", { name: "Verbinden" }).click();
  await expect(page.getByText(/Nicht verbunden: Der Schlüssel des Hotels ist ungültig/)).toBeVisible();
  await page.getByTestId("room-link").getByLabel("Schlüssel des Hotels").fill(key);
  await page.getByTestId("room-link").getByRole("button", { name: "Verbinden" }).click();
  await expect(page.getByText(`Verbunden mit ${a.hotel.name}.`)).toBeVisible();
  await expect(page.getByTestId("room-link")).toContainText(key.slice(0, 10));
  await page.getByRole("button", { name: "Verbindung trennen" }).click();
  await expect(page.getByText("Verbindung zum Hotel getrennt.")).toBeVisible();
});
