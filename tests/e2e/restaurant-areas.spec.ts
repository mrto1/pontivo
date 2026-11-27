import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { hotelMembers, hotels, sitePages } from "../../src/db/schema";
import { makeHotel } from "../helpers";

const uid = () => Math.random().toString(36).slice(2, 8);
async function login(context: import("@playwright/test").BrowserContext, baseURL: string, hotelId: string, role: "owner" | "service") {
  const email = `area-${uid()}@example.ch`;
  await addMember(hotelId, email, role, "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL }]);
}

/** Zwei Bereiche (SPEC 20.1): Umschalter, Bereich folgt der Seite, geteilte Seiten bleiben, Hinweis in der Tagesliste */
test("Hotel mit Restaurant: Umschalter Hotel | Restaurant", async ({ page, context, baseURL }) => {
  const h = await makeHotel();
  await db().insert(hotelModules).values([{ hotelId: h.hotel.id, module: "restaurant", enabled: true }]).onConflictDoNothing();
  await login(context, baseURL!, h.hotel.id, "owner");
  const nav = page.locator(".admin-nav");

  await page.goto(`/admin/${h.hotel.id}`);
  const sw = page.getByRole("group", { name: "Bereich wählen" });
  await expect(sw.getByRole("button", { name: /Hotel/ })).toHaveAttribute("aria-pressed", "true");
  await expect(nav.getByRole("link", { name: "Kalender" })).toBeVisible();
  await expect(page.getByTestId("dining-hint")).toContainText("Restaurant heute: 0 Reservationen");

  await sw.getByRole("button", { name: /Restaurant/ }).click();
  await expect(page).toHaveURL(/\/restaurant\/heute$/, { timeout: 20_000 });
  await expect(nav.getByRole("link", { name: "Reservationen" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Heute", level: 1 })).toBeVisible();

  // geteilte Seite bleibt im Bereich Gastronomie; Startseite führt zur Tagesübersicht
  await expect.poll(async () => (await context.cookies()).find((c) => c.name.startsWith("pv_area_"))?.value).toBe("dining");
  await page.goto(`/admin/${h.hotel.id}/vouchers`);
  await expect(nav.getByRole("link", { name: "Reservationen" })).toBeVisible();
  await page.goto(`/admin/${h.hotel.id}`);
  await expect(page).toHaveURL(/\/restaurant\/heute$/);
  // Seite der Unterkunft wechselt den Bereich von selbst (z. B. Link aus einer Mail)
  await page.goto(`/admin/${h.hotel.id}/bookings`);
  await expect(nav.getByRole("link", { name: "Kalender" })).toBeVisible();
  await expect(sw.getByRole("button", { name: /Hotel/ })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await context.cookies()).find((c) => c.name.startsWith("pv_area_"))?.value).toBe("lodging"); // gemerkt, sobald die Seite geladen ist
  await page.goto(`/admin/${h.hotel.id}`);
  await expect(page.getByRole("heading", { name: "Tagesliste" })).toBeVisible();
});

test("Reines Restaurant: nur Gastronomie, kein Umschalter; Service landet in der Tagesübersicht", async ({ page, context, baseURL }) => {
  const { hotel } = await makeHotel({}, []);
  await db().update(hotels).set({ propertyType: "restaurant", status: "draft", onboarding: { startedAt: new Date().toISOString(), reminders: 0 } }).where(eq(hotels.id, hotel.id));
  await db().insert(hotelModules).values([{ hotelId: hotel.id, module: "restaurant", enabled: true }]).onConflictDoNothing();
  await login(context, baseURL!, hotel.id, "owner");
  await page.goto(`/admin/${hotel.id}`);
  await expect(page).toHaveURL(/\/restaurant\/heute$/);
  await expect(page.getByRole("group", { name: "Bereich wählen" })).toHaveCount(0);
  await expect(page.locator(".admin-nav a")).toHaveText(["Heute", "Reservationen", "Bestellungen", "Finanzen"]);
  await page.goto(`/admin/${hotel.id}/einstellungen`);
  await expect(page.getByRole("link", { name: "Zimmer & Tarife" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Speisekarte" }).first()).toBeVisible();
  // Assistent mit Restaurant-Schritten
  await page.goto(`/admin/${hotel.id}/einrichten?step=tische`);
  await page.getByLabel("Anzahl Tische").fill("6");
  const saved = page.waitForResponse((r) => r.request().method() === "POST"); // sonst bricht das nächste goto das Speichern ab (flaky)
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await saved;
  await page.goto(`/admin/${hotel.id}/einrichten?step=tische`); // Angaben fehlen noch, darum führt «weiter» zuerst dorthin
  await expect(page.getByText("6 Tische mit zusammen 24 Plätzen")).toBeVisible();
  // Konzept 7a: Reservation sofort live, ohne Stripe; Checkliste im Heute
  const owners = await db().select({ id: hotelMembers.userId }).from(hotelMembers).where(eq(hotelMembers.hotelId, hotel.id));
  for (const o of owners) await db().update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, o.id));
  await page.goto(`/admin/${hotel.id}/einrichten?step=reservierung`);
  await page.getByLabel("Mittag von").fill("11:30"); await page.getByLabel("bis").first().fill("13:30");
  await page.getByRole("button", { name: "Reservation live schalten" }).click();
  await expect(page).toHaveURL(/ok=1/);
  await page.goto(`/admin/${hotel.id}/einrichten?step=reservierung`);
  await expect(page.getByTestId("reservation-live")).toContainText("Reservation ist online");
  await expect(page.getByRole("img", { name: "QR-Code zur Tischreservation" })).toBeVisible();
  await page.goto(`/admin/${hotel.id}/restaurant/heute`);
  const check = page.getByTestId("ready-checklist");
  await expect(check).toContainText("Bereit für den Betrieb");
  await expect(check.getByRole("link", { name: "Speisekarte" })).toBeVisible(); // noch offen
  await expect(check.locator("li.done", { hasText: "Reservation online" })).toHaveCount(1);
  // Tag wechseln wie in der Tagesliste des Hotels
  await page.getByRole("link", { name: "Folgetag" }).click();
  await expect(page).toHaveURL(/restaurant\/heute\?day=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("heading", { name: "Tagesübersicht" })).toBeVisible();
  await expect(page.getByTestId("ready-checklist")).toHaveCount(0);

  const h2 = await makeHotel();
  await db().insert(hotelModules).values([{ hotelId: h2.hotel.id, module: "restaurant", enabled: true }]).onConflictDoNothing();
  await context.clearCookies();
  await login(context, baseURL!, h2.hotel.id, "service");
  await page.goto(`/admin/${h2.hotel.id}`);
  await expect(page).toHaveURL(/\/restaurant\/heute$/);
  await expect(page.getByRole("group", { name: "Bereich wählen" })).toHaveCount(0);
});

/** R2-Rest (SPEC 20.2): Baustein und Knopf «Tisch reservieren» auf der Website, Kartei-Notiz bei der Reservation */
test("Restaurant-Website: Tisch reservieren, Kartei bei der Reservation", async ({ page, context, baseURL }) => {
  const { hotel } = await makeHotel({}, []);
  await db().update(hotels).set({ propertyType: "restaurant" }).where(eq(hotels.id, hotel.id));
  await db().insert(hotelModules).values([{ hotelId: hotel.id, module: "restaurant", enabled: true }, { hotelId: hotel.id, module: "guestnotes", enabled: true }]).onConflictDoNothing();
  const { saveSettings, getSettings } = await import("../../src/services/reservations");
  await saveSettings(hotel.id, { ...(await getSettings(hotel.id)), onlineEnabled: true, leadHours: 0, windows: [{ from: "18:00", to: "21:00" }] }, "e2e");
  await db().insert(sitePages).values({ hotelId: hotel.id, slug: "", title: { de: "Startseite" }, navLabel: {}, showInNav: false, sortOrder: 0, blocks: [{ id: "r1", type: "reserve", heading: {}, intro: { de: "Wir freuen uns auf Sie." } }] }).onConflictDoNothing();

  await page.goto(`/h/${hotel.slug}/de`);
  await expect(page.locator(".sticky-book")).toHaveText("Tisch reservieren");
  const block = page.getByTestId("reserve-block");
  // Morgen statt heute: am Abend nach 21 Uhr gibt es heute keine freien Zeiten mehr
  const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
  await block.getByLabel("Datum").fill(tomorrow);
  await block.getByLabel("Personen").fill("3");
  await block.getByRole("button", { name: "Freie Zeiten zeigen" }).click();
  await expect(page).toHaveURL(/\/tisch\?date=.*party=3/);
  const form = page.getByTestId("reserve-form");
  await form.getByLabel("Name").fill("Herr Treu");
  await form.getByLabel("E-Mail").fill("treu@example.ch");
  await form.locator("label:has(input[name=time])").first().click(); // Gast wählt die Zeit (keine Vorauswahl)
  await form.getByRole("button", { name: "Verbindlich reservieren" }).click();
  await expect(page.getByRole("heading", { name: "Ihr Tisch ist reserviert." })).toBeVisible();
  const day = new URL(page.url().replace(/\/tisch\/[^?]+/, "/x"), "http://x").searchParams.get("date");

  await login(context, baseURL!, hotel.id, "owner");
  const { reservationsBetween } = await import("../../src/services/reservations");
  const [r] = await reservationsBetween(hotel.id, "2000-01-01", "2100-01-01");
  await page.goto(`/admin/${hotel.id}/restaurant/reservierungen?day=${day ?? r.day}`);
  const list = page.getByTestId("res-list");
  await list.getByRole("link", { name: "Kartei" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Tags (Komma)").fill("Fensterplatz");
  await drawer.getByLabel("Notiz").fill("ohne Nüsse");
  await drawer.getByRole("button", { name: "Speichern" }).click();
  await expect(page).toHaveURL(/restaurant\/reservierungen/); // zurück zur Liste
  await expect(page.getByText("Kartei gespeichert")).toBeVisible();
  await expect(page.getByTestId("res-list").getByText("Kartei: ohne Nüsse")).toBeVisible();
  await page.goto(`/admin/${hotel.id}/guestbook`);
  await expect(page.getByText("treu@example.ch")).toBeVisible();
});
