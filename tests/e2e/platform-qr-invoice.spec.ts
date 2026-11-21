import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotels, platformCharges, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { savePlatformBilling } from "../../src/services/platform-settings";
import { addDays, todayIn } from "../../src/domain/dates";
import { makeHotel } from "../helpers";

const uid = () => Math.random().toString(36).slice(2, 8);

/** SPEC 20.6: Betrieb wählt QR-Rechnung, sieht den Zahlteil; Plattform erfasst die Zahlung */
test("Grundgebühr per QR-Rechnung: wählen, Zahlteil, Zahlung in der Plattform-Verwaltung erfassen", async ({ page, context, baseURL }) => {
  const { hotel } = await makeHotel();
  await db().update(hotels).set({ addressLine: "Dorfstrasse 3", postalCode: "7270", city: "Davos" }).where(eq(hotels.id, hotel.id));
  await savePlatformBilling({ iban: "CH44 3199 9123 0008 8901 2", paymentDays: 30 }, "e2e");
  const email = `qr-${uid()}@example.ch`;
  await addMember(hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await db().update(users).set({ isPlatformAdmin: true }).where(eq(users.id, u.id));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);

  await page.goto(`/mypontivo/${hotel.id}/zahlungen`);
  await page.getByTestId("billing-method").getByLabel(/QR-Rechnung/).check();
  await page.getByRole("button", { name: "Zahlungsart speichern" }).click();
  await expect(page.getByText(/Grundgebühr per QR-Rechnung: gilt ab der nächsten Monatsrechnung/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Karte hinterlegen/ })).toHaveCount(0);

  const today = todayIn("Europe/Zurich");
  const no = `R-2099-${String(Math.floor(Math.random() * 90000) + 10000)}`;
  const [c] = await db().insert(platformCharges).values({ hotelId: hotel.id, month: "2026-10", feesRappen: 0, minimumRappen: 1900, chargeRappen: 1900, netRappen: 1900, status: "invoiced", method: "qr", dueDate: addDays(today, 30), invoiceNo: no, invoiceDate: today }).returning();
  await page.goto(`/mypontivo/${hotel.id}/plattform-rechnung/${c.id}`);
  await expect(page.getByTestId("platform-qr")).toContainText("Zahlteil");
  await expect(page.getByTestId("platform-qr")).toContainText("CH44 3199 9123 0008 8901 2");
  await expect(page.getByText("Zu bezahlen")).toBeVisible();

  await page.goto("/admin/plattform/rechnungen");
  const row = page.getByTestId("open-qr").getByRole("row", { name: new RegExp(no) });
  await expect(row).toContainText("offen, fällig");
  await row.getByRole("button", { name: "Bezahlt" }).click();
  await expect(page.getByText("Zahlung erfasst")).toBeVisible();
  await expect(page.getByTestId("open-qr").getByRole("row", { name: new RegExp(no) })).toHaveCount(0);
});
