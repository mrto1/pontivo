import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotels, offers, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { createInquiry } from "../../src/services/inquiries";
import { makeHotel } from "../helpers";

/** Anfrage → Angebot im Admin erstellen und senden → Kunde sieht es per Link und nimmt an. */
test("Angebot: erstellen, senden, per Link annehmen", async ({ page, context, baseURL }) => {
  const h = await makeHotel();
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  await createInquiry(hotel, { kind: "seminar", name: "Anna Muster", email: "anna@firma.ch", dateFrom: null, dateTo: null, persons: 10, timeOfDay: null, message: "Tagung im Mai", language: "de", pageSlug: "" });
  const email = `owner-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);
  await page.goto(`/admin/${h.hotel.id}/inquiries`);
  await page.getByRole("button", { name: "Angebot erstellen" }).click();
  await expect(page.getByRole("heading", { name: "Angebot erstellen" })).toBeVisible();
  await page.getByLabel("Beschreibung").first().fill("Tagungspauschale");
  await page.getByLabel("Preis CHF").first().fill("500");
  await page.getByRole("button", { name: "Speichern und an den Kunden senden" }).click();
  await expect(page.getByText("Angebot gesendet.")).toBeVisible();
  const [o] = await db().select().from(offers).where(eq(offers.hotelId, h.hotel.id));
  const cust = await context.browser()!.newContext();
  const p2 = await cust.newPage();
  await p2.goto(`${baseURL}/o/${o.publicToken}`);
  await expect(p2.getByText("Tagungspauschale")).toBeVisible();
  await p2.getByRole("button", { name: "Angebot annehmen" }).click();
  await expect(p2.getByText("Sie haben dieses Angebot angenommen").first()).toBeVisible();
  await cust.close();
});
