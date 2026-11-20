import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { updateInvoicingSettings } from "../../src/services/invoicing";
import { createDevice, saveItem, saveTable, verifyHotel, receiptsOfDay } from "../../src/services/pos";
import { makeHotel } from "../helpers";

/** Kasse ohne Verbindung: bestellen und kassieren, danach werden die Vorgänge übertragen (SPEC 19.16). */
test("Kasse: offline bestellen und kassieren, später übertragen", async ({ page, context, baseURL }) => {
  const id = Math.random().toString(36).slice(2, 8);
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
  await updateInvoicingSettings(h.hotel, { vatLiable: true, vatNumber: "CHE-123.456.789 MWST" }, "e2e");
  // Module direkt eintragen (die Modul-Dienste laden Next.js, das der Test-Lader nicht auflöst)
  for (const module of ["invoicing", "pos"]) await db().insert(hotelModules).values({ hotelId: h.hotel.id, module, enabled: true }).onConflictDoUpdate({ target: [hotelModules.hotelId, hotelModules.module], set: { enabled: true } });
  const email = `kellner-${id}@example.ch`;
  await addMember(h.hotel.id, email, "service", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await saveItem(h.hotel.id, null, { category: "Essen", name: "Gerstensuppe", priceRappen: 1000, vatDineInBps: 810, vatTakeawayBps: 260 }, "e2e");
  await saveTable(h.hotel.id, "Tisch 1", "e2e");
  await createDevice(h.hotel.id, "T1", "Tablet", "e2e");
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);

  await page.goto(`/mypontivo/${h.hotel.id}/kasse`);
  await page.getByRole("button", { name: /^T1/ }).click();
  await expect(page.getByTestId("status")).toContainText("alles übertragen");

  // online: Tisch eröffnen, eine Suppe bestellen
  await page.getByRole("button", { name: "Eröffnen", exact: true }).click();
  await page.getByRole("button", { name: /Gerstensuppe/ }).click();
  await expect(page.getByTestId("status")).toContainText("alles übertragen");

  // Verbindung weg: weiter bestellen und bar kassieren
  await context.setOffline(true);
  await expect(page.getByTestId("status")).toContainText("Ohne Verbindung");
  await page.getByRole("button", { name: /Gerstensuppe/ }).click();
  await page.getByRole("button", { name: "Kassieren" }).click();
  await expect(page.getByTestId("msg")).toContainText("Bon T1-000001 über CHF 20.00");
  await expect(page.getByTestId("status")).toContainText("Vorgänge noch nicht übertragen");

  // zweiter Bon ohne Verbindung: lückenlose Nummer
  await page.getByRole("button", { name: /Gerstensuppe/ }).click();
  await page.getByRole("button", { name: "Kassieren" }).click();
  await expect(page.getByTestId("msg")).toContainText("Bon T1-000002 über CHF 10.00");

  // Verbindung zurück: alles wird übernommen
  await context.setOffline(false);
  await expect(page.getByTestId("status")).toContainText("alles übertragen", { timeout: 30000 });
  expect(await verifyHotel(h.hotel.id)).toEqual({ receipts: 2, brokenAtSeq: null, gaps: [] });
  const day = (await db().query.posReceipts.findFirst({ where: (r, { eq: e }) => e(r.hotelId, h.hotel.id) }))!.businessDay;
  const rs = await receiptsOfDay(h.hotel.id, day);
  expect(rs.map((r) => [r.receipt.number, r.receipt.totalRappen])).toEqual([["T1-000001", 2000], ["T1-000002", 1000]]);
});
