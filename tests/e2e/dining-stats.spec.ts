import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { makeHotel } from "../helpers";

test("Auswertung Restaurant öffnet für den Inhaber", async ({ page, context, baseURL }) => {
  const h = await makeHotel();
  await db().insert(hotelModules).values([{ hotelId: h.hotel.id, module: "restaurant", enabled: true }, { hotelId: h.hotel.id, module: "pos", enabled: true }]).onConflictDoNothing();
  const email = `st-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);
  await page.goto(`/admin/${h.hotel.id}/restaurant/auswertung`);
  await expect(page.getByRole("heading", { name: /^Auswertung/ })).toBeVisible();
  await expect(page.getByTestId("dining-totals")).toContainText("Umsatz");
  await expect(page.getByTestId("stats-waiters")).toContainText("Keine Bons");
});
