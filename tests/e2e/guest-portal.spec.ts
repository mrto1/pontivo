import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { bookings, hotels, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { randomBytes } from "node:crypto";
import { addDays, todayIn } from "../../src/domain/dates";
import { inDays, makeHotel } from "../helpers";

/** Gästeportal (SPEC 19.41): Gast sendet Wunsch → Rezeption erledigt ihn im Posteingang → Gast sieht den Stand → Selbst-Check-out. */
test("Gästeportal: Wunsch, Erledigt, Check-out", async ({ page, context, baseURL }) => {
  const h = await makeHotel();
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  const checkin = inDays(1);
  // Bestätigte Buchung direkt anlegen (die Buchungsstrecke ist in booking.spec.ts geprüft)
  const [b] = await db().insert(bookings).values({
    hotelId: hotel.id, reference: `PNT-${randomBytes(3).toString("hex").toUpperCase()}`, publicToken: randomBytes(16).toString("hex"), source: "direct", status: "confirmed",
    checkin, checkout: addDays(checkin, 2), adults: 2, language: "de",
  } as never).returning();

  const cust = await context.browser()!.newContext();
  const gp = await cust.newPage();
  await gp.goto(`${baseURL}/b/${b.publicToken}`);
  await gp.getByRole("combobox", { name: "Wunsch wählen" }).selectOption("towels");
  await gp.getByRole("button", { name: "Wunsch senden" }).click();
  await expect(gp.getByText("Ihr Wunsch ist beim Haus angekommen")).toBeVisible();
  await expect(gp.getByText("offen").first()).toBeVisible();

  const email = `owner-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);
  await page.goto(`/mypontivo/${h.hotel.id}/inbox?quelle=wuensche`);
  await expect(page.getByText("Zusätzliche Handtücher")).toBeVisible();
  await page.getByPlaceholder("Kurze Antwort an den Gast (optional)").fill("Liegen bereit");
  await page.getByRole("button", { name: "Erledigt (Gast sieht es)" }).click();

  await gp.reload();
  await expect(gp.getByText("erledigt").first()).toBeVisible();
  await expect(gp.getByText("Liegen bereit")).toBeVisible();

  // Abreisetag heute: Selbst-Check-out
  const today = todayIn(hotel.timezone);
  await db().update(bookings).set({ checkin: addDays(today, -2), checkout: today }).where(eq(bookings.id, b.id));
  await gp.reload();
  await gp.getByRole("button", { name: "Ich checke jetzt aus" }).click();
  await expect(gp.getByText("Sie sind ausgecheckt")).toBeVisible();
  await cust.close();
});
