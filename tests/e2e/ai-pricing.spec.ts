import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { makeHotel } from "../helpers";

/** Preisseite mit eingeschalteter KI-Preisempfehlung: lädt, zeigt beide Knöpfe; ohne API-Schlüssel nur die Regeln. */
test("Preisempfehlung: KI-Modul an, Seite lädt", async ({ page, context, baseURL }) => {
  const h = await makeHotel();
  await db().insert(hotelModules).values([{ hotelId: h.hotel.id, module: "pricing_rules", enabled: true }, { hotelId: h.hotel.id, module: "ai_chat", enabled: true, settings: { enabledSince: "2020-01-01", terms: { planCode: "zusatz", name: "KI-Zusatz", priceRappen: 2900, included: 250, packSize: 100, packPriceRappen: 500, acceptedAt: "2020-01-01T00:00:00Z", acceptedBy: "e2e", includesPricing: true } } }]);
  const email = `owner-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);
  await page.goto(`/admin/${h.hotel.id}/preise`);
  await expect(page.getByRole("heading", { name: "Preisempfehlung" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Jetzt nach Regeln neu berechnen" })).toBeVisible();
  // KI-Zusatz-Seite nennt den Tarif
  await page.goto(`/admin/${h.hotel.id}/ki-chat`);
  await expect(page.getByText("Enthält die KI-Preisempfehlung")).toBeVisible();
});
