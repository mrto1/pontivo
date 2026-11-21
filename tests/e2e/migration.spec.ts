import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { addDays, todayIn } from "../../src/domain/dates";
import { makeHotel } from "../helpers";

/** Datenübernahme: Datei hochladen, Prüfbericht, Import ausführen, rückgängig machen. */
test("Datenübernahme: prüfen, importieren, rückgängig", async ({ page, context, baseURL }) => {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 2, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
  const email = `owner-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);

  const d = (n: number) => addDays(todayIn(h.hotel.timezone), n);
  const head = "externe_nummer;anreise;abreise;zimmertyp;tarif;erwachsene;kinder;vorname;nachname;email;telefon;sprache;preis_total;bezahlt;status;bemerkung";
  const csv = (...l: string[]) => Buffer.from([head, ...l].join("\n"));
  const row = (ref: string, type = "Doppelzimmer") => `${ref};${d(20)};${d(22)};${type};;2;0;Anna;Muster;;;de;300.00;0;bestaetigt;`;

  await page.goto(`/admin/${h.hotel.id}/migration`);
  await expect(page.getByRole("heading", { name: "Datenübernahme" })).toBeVisible();

  // fehlerhafte Datei: Zimmertyp unbekannt → kein Import-Knopf
  await page.setInputFiles("input[type=file]", { name: "alt.csv", mimeType: "text/csv", buffer: csv(row("X-1", "Suite")) });
  await page.getByRole("button", { name: "Prüfen (Trockenlauf)" }).click();
  await expect(page.locator("#bericht")).toContainText("Suite");
  await expect(page.getByRole("button", { name: /Import ausführen/ })).toHaveCount(0);

  // gute Datei
  await page.setInputFiles("input[type=file]", { name: "alt.csv", mimeType: "text/csv", buffer: csv(row("X-1"), row("X-2")) });
  await page.getByRole("button", { name: "Prüfen (Trockenlauf)" }).click();
  await expect(page.locator("#bericht")).toContainText("2 würden übernommen");
  await page.getByRole("button", { name: /Import ausführen \(2/ }).click();
  await expect(page.getByText("Import ausgeführt. Bitte prüfen")).toBeVisible();
  await expect(page.locator("#bericht")).toContainText("ausgeführt");

  // Wer importiert, ist im Parallelbetrieb: Banner auf jeder Seite, Checkliste erreichbar
  await expect(page.locator(".setup-banner.parallel")).toContainText("Parallelbetrieb");
  await page.locator(".setup-banner.parallel").getByRole("link", { name: "Umschalt-Checkliste" }).click();
  await expect(page.getByRole("heading", { name: "Umschalt-Checkliste" })).toBeVisible();
  await expect(page.locator("ol > li")).toHaveCount(7);
  await expect(page.getByRole("button", { name: /Umschalten: Parallelbetrieb beenden/ })).toBeDisabled();
  await page.goto(`/admin/${h.hotel.id}/migration?job=${new URL(page.url()).searchParams.get("job") ?? ""}`);
  await page.getByRole("link", { name: /alt\.csv/ }).first().click();
  await page.getByRole("button", { name: "Import rückgängig machen" }).click();
  await expect(page.locator("#bericht")).toContainText("2 Buchungen entfernt");

  const zip = await page.request.get(`/admin/${h.hotel.id}/migration/export`);
  expect(zip.status()).toBe(200);
  expect(zip.headers()["content-type"]).toBe("application/zip");
});
