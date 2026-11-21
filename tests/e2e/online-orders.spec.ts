import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, hotels, onlineOrderSettings, posItems, restaurantSettings, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { acceptOrder, createOnlineOrder, saveZone } from "../../src/services/online-orders";
import { makeHotel } from "../helpers";

const uid = () => Math.random().toString(36).slice(2, 8);
const allDay = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [{ from: "00:00", to: "23:59" }]]));

async function login(context: import("@playwright/test").BrowserContext, baseURL: string, hotelId: string, role: "owner" | "service" | "driver") {
  const email = `ord-${uid()}@example.ch`;
  await addMember(hotelId, email, role, "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await db().update(users).set({ name: `Fahrer ${uid()}` }).where(eq(users.id, u.id));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL }]);
}

/** Restaurant, live, Online-Bestellung eingeschaltet (Probe bestanden), ein Artikel */
async function restaurant(extra: Partial<typeof onlineOrderSettings.$inferInsert> = {}) {
  const { hotel } = await makeHotel({}, []);
  await db().update(hotels).set({ propertyType: "restaurant", status: "live", contactPhone: "079 123 45 67" }).where(eq(hotels.id, hotel.id));
  await db().insert(hotelModules).values([{ hotelId: hotel.id, module: "restaurant", enabled: true }]).onConflictDoNothing();
  await db().insert(restaurantSettings).values({ hotelId: hotel.id, windows: [], openingHours: allDay }).onConflictDoUpdate({ target: restaurantSettings.hotelId, set: { openingHours: allDay } });
  const [item] = await db().insert(posItems).values({ hotelId: hotel.id, category: "Pizza", name: "Margherita", priceRappen: 1800, vatDineInBps: 810, vatTakeawayBps: 260, allergens: ["gluten", "milk"], description: "Tomate, Mozzarella" }).returning();
  await db().insert(onlineOrderSettings).values({ hotelId: hotel.id, enabled: true, testPassedAt: new Date(), pickup: true, cashPickup: true, leadMin: 0, cutoffMin: 0, ...extra });
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  return { h, item };
}

test("Gast bestellt zum Abholen (bar), Restaurant nimmt an, meldet bereit und abgeholt", async ({ page, context, baseURL, browser }) => {
  const { h } = await restaurant();
  // Gast
  const guest = await browser.newPage();
  await guest.goto(`/h/${h.slug}/de/bestellen`);
  await expect(guest.getByTestId("menu-Margherita")).toContainText("Allergene: Gluten, Milch (Laktose)");
  await expect(guest.getByText("Fragen zu Allergenen: bitte anrufen.")).toBeVisible();
  await guest.getByRole("button", { name: "Margherita Hinzufügen" }).click();
  await guest.getByRole("button", { name: "Margherita Hinzufügen" }).click();
  await expect(guest.getByTestId("order-total")).toHaveText("CHF 36.00");
  await guest.getByLabel("Name", { exact: true }).fill("Anna Gast");
  await guest.getByLabel("Telefon").fill("079 555 66 77");
  await guest.getByLabel("Bar bei Abholung").check();
  await guest.getByRole("button", { name: /Weiter zur Zahlung|Bestellung senden/ }).click();
  await expect(guest.getByTestId("order-status")).toContainText("Bestellnummer A-001");
  await expect(guest.getByTestId("order-status")).toContainText("Bestellung eingegangen");
  const statusUrl = guest.url();

  // Restaurant: Bestellbildschirm mit Selbstprüfung
  await login(context, baseURL!, h.id, "service");
  await page.goto(`/mypontivo/${h.id}/restaurant/bestellungen`);
  await expect(page.getByRole("heading", { name: /Online-Bestellungen/ })).toContainText("1 neu");
  await page.getByRole("button", { name: "Prüfung starten" }).click();
  await page.getByRole("button", { name: "Ja, gehört" }).click();
  await expect(page.getByTestId("order-screen-status")).toBeVisible();
  const card = page.getByTestId("order-A-001");
  await expect(card).toContainText("2 × Margherita");
  await expect(card).toContainText("bar CHF 36.00");
  await card.getByRole("button", { name: "+10 Min." }).click();
  await page.getByTestId("order-A-001").getByRole("button", { name: "Bereit" }).click();
  await page.getByTestId("order-A-001").getByRole("button", { name: /Abgeholt/ }).click();
  await expect(page.getByTestId("order-A-001")).toHaveCount(0);
  await expect(page.getByText("Erledigt heute (1)")).toBeVisible();

  await guest.goto(statusUrl);
  await expect(guest.getByTestId("order-status")).toContainText("Erledigt");
  // Pause: Gäste sehen «Zurzeit keine Online-Bestellungen»
  await page.getByRole("button", { name: "30 Min." }).click();
  await expect(page.getByText(/Pausiert bis/)).toBeVisible();
  await guest.goto(`/h/${h.slug}/de/bestellen`);
  await expect(guest.getByTestId("orders-closed")).toBeVisible();
});

test("Lieferung: Fahrer sieht Adresse und Betrag, fährt los und liefert bar", async ({ page, context, baseURL }) => {
  const { h, item } = await restaurant({ delivery: true, cashDelivery: true });
  await saveZone(h.id, null, { name: "Stadt", postalCodes: ["9000"], minOrderRappen: 0, feeRappen: 500, freeFromRappen: null, extraMinutes: 0 }, "e2e");
  const { order } = await createOnlineOrder(h, { kind: "delivery", time: "asap", payment: "cash", name: "Ben", phone: "079 222 33 44", email: "", language: "de", lines: [{ itemId: item.id, quantity: 1, optionIds: [], note: "" }], address: { street: "Marktgasse", houseNo: "5", postalCode: "9000", city: "St. Gallen", bell: "Muster" } });
  await acceptOrder(h, order.id, 0, "e2e");
  await login(context, baseURL!, h.id, "driver");
  await page.goto(`/mypontivo/${h.id}`);
  await expect(page).toHaveURL(/\/restaurant\/fahrer$/);
  const card = page.getByTestId(`delivery-${order.number}`);
  await expect(card).toContainText("Marktgasse 5, 9000 St. Gallen");
  await expect(card).toContainText("Bar einkassieren: CHF 23.00");
  await card.getByRole("button", { name: "Unterwegs" }).click();
  await page.getByTestId(`delivery-${order.number}`).getByRole("button", { name: "Geliefert, bar erhalten" }).click();
  await expect(page.getByText("Keine offenen Lieferungen.")).toBeVisible();
  // Tagesabrechnung ohne Modul Kasse (SPEC 20.8)
  await login(context, baseURL!, h.id, "owner");
  await page.goto(`/mypontivo/${h.id}/restaurant/online-verkaeufe`);
  await expect(page.getByTestId("online-sales")).toContainText("CHF 23.00");
  await expect(page.getByRole("link", { name: "CSV" })).toBeVisible();
  await page.goto(`/h/${h.slug}/de/bestellung/${order.publicToken}`);
  await expect(page.getByTestId("order-receipt")).toContainText("Quittung ONL-");
});

test("Einstellungen: Live-Prüfung nennt Gründe, Liefergebiet anlegen, Speisekarte mit Allergenen", async ({ page, context, baseURL }) => {
  const { h } = await restaurant();
  await db().update(onlineOrderSettings).set({ enabled: false, testPassedAt: null }).where(eq(onlineOrderSettings.hotelId, h.id));
  await login(context, baseURL!, h.id, "owner");
  await page.goto(`/mypontivo/${h.id}/restaurant/bestellung-einstellungen`);
  await expect(page.getByTestId("orders-live")).toContainText("Probebestellung noch nicht bestanden");
  await page.getByLabel("Name").fill("Stadt");
  await page.getByLabel("Postleitzahlen").fill("9000, 9008");
  await page.getByRole("button", { name: "Gebiet anlegen" }).click();
  await expect(page.getByRole("cell", { name: "9000, 9008" })).toBeVisible();
  await page.getByRole("button", { name: "Probebestellung starten" }).click();
  await expect(page).toHaveURL(/restaurant\/bestellungen\?probe=1/);
  await expect(page.getByTestId("order-T-001")).toBeVisible();
  await page.goto(`/mypontivo/${h.id}/restaurant/artikel`);
  await page.getByTestId("items-online").getByText("Margherita").click();
  await page.getByTestId("items-online").getByLabel("Sesam").check();
  await page.getByTestId("items-online").getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByTestId("items-online")).toContainText("Gluten, Milch (Laktose), Sesam");
});

test("Restaurant-Website aus der Vorlage: Speisekarte mit Allergenen, Öffnungszeiten, Online bestellen", async ({ page }) => {
  const { h } = await restaurant();
  const { ensureHomePage } = await import("../../src/services/site");
  await ensureHomePage(h, "e2e");
  await page.goto(`/h/${h.slug}/de`);
  await expect(page.getByRole("heading", { name: "Speisekarte" })).toBeVisible();
  await expect(page.locator(".blk-menu")).toContainText("Margherita");
  await expect(page.locator(".blk-menu")).toContainText("Allergene: Gluten, Milch (Laktose)");
  await expect(page.getByRole("heading", { name: "Öffnungszeiten" })).toBeVisible();
  await page.getByTestId("order-block").click();
  await expect(page).toHaveURL(/\/bestellen$/);
});
