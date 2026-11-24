import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { invoices, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { makeHotel } from "../helpers";

/** Rechnungen: Suche nach Empfänger (Suche nach Referenz und Nummer deckt tests/integration/invoicing.test.ts ab) */
test("Rechnungen: Suche findet die Rechnung, sonst «Keine Rechnung gefunden»", async ({ page, context, baseURL }) => {
  const h = await makeHotel();
  await db().insert(invoices).values({ hotelId: h.hotel.id, status: "issued", number: "R-2026-0001", issuedOn: "2026-11-01", recipient: { name: "Zora Suchtest" }, totalRappen: 12000, createdBy: "e2e" });
  await db().insert(invoices).values({ hotelId: h.hotel.id, status: "issued", number: "R-2026-0002", issuedOn: "2026-11-02", recipient: { name: "Otto Andere" }, totalRappen: 5000, createdBy: "e2e" });
  const email = `inv-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);

  await page.goto(`/admin/${h.hotel.id}/invoices`);
  await expect(page.getByRole("table")).toContainText("Otto Andere");
  await page.getByLabel("Suche").fill("suchtest");
  await page.getByRole("button", { name: "Suchen" }).click();
  await expect(page.getByRole("table")).toContainText("Zora Suchtest");
  await expect(page.getByRole("table")).not.toContainText("Otto Andere");
  await page.getByLabel("Suche").fill("gibtesnicht");
  await page.getByRole("button", { name: "Suchen" }).click();
  await expect(page.getByText("Keine Rechnung gefunden.")).toBeVisible();
});
