import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { createDevice, openOrder, saveItem } from "../../src/services/pos";
import { makeHotel } from "../helpers";

/** Optionen und Sonderwünsche (SPEC 19.49): Gruppe anlegen, Artikel zuordnen, bestellen mit Pflichtwahl und Sonderwunsch */
test("Restaurant: Garstufe als Pflichtgruppe, Bestellung mit Sonderwunsch", async ({ page, context, baseURL }) => {
  const h = await makeHotel();
  await db().insert(hotelModules).values([{ hotelId: h.hotel.id, module: "invoicing", enabled: true }, { hotelId: h.hotel.id, module: "restaurant", enabled: true }, { hotelId: h.hotel.id, module: "pos", enabled: true }]).onConflictDoNothing();
  const email = `opt-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);
  await saveItem(h.hotel.id, null, { category: "Essen", name: "Entrecôte", priceRappen: 4200, vatDineInBps: 810, vatTakeawayBps: 260 }, "e2e");
  const dev = await createDevice(h.hotel.id, "T1", "Tablet", "e2e");
  const order = await openOrder(h.hotel.id, { tableId: null, deviceId: dev.id, label: "Bar" }, "e2e");

  await page.goto(`/admin/${h.hotel.id}/restaurant/artikel`);
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Neue Gruppe" }) });
  await form.getByLabel("Name").fill("Garstufe");
  await form.getByRole("switch").click();
  await form.getByRole("button", { name: "Gruppe anlegen" }).click();
  await expect(page.getByText("Gruppe gespeichert")).toBeVisible();
  const group = page.getByTestId("option-groups").locator(".card").filter({ has: page.getByRole("heading", { name: /Garstufe/ }) });
  const add = group.locator("form").filter({ has: page.getByLabel("Neue Option") });
  await add.getByLabel("Neue Option").fill("medium");
  await add.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByText("Option gespeichert")).toBeVisible();
  await group.getByLabel("Entrecôte").check();
  await group.getByRole("button", { name: "Zuordnung speichern" }).click();
  await expect(page.getByText("Zuordnung gespeichert")).toBeVisible();

  await page.goto(`/admin/${h.hotel.id}/restaurant/bestellung/${order.id}`);
  await page.getByLabel("Sonderwunsch (optional)").fill("ohne Zwiebeln");
  await page.getByRole("button", { name: "Hinzufügen" }).click();
  const step = page.getByTestId("options-step");
  await expect(step).toBeVisible();
  await expect(step.getByLabel("Sonderwunsch")).toHaveValue("ohne Zwiebeln");
  await step.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByText("Bitte wählen: Garstufe")).toBeVisible();
  await page.getByTestId("options-step").getByLabel("medium").check();
  await page.getByTestId("options-step").getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByRole("cell", { name: "Entrecôte · medium · ohne Zwiebeln" })).toBeVisible();
});

/** Küchenbildschirm (SPEC 19.49 Etappe B) */
test("Küche: Posten erscheint, antippen meldet fertig", async ({ page, context, baseURL }) => {
  const h = await makeHotel();
  await db().insert(hotelModules).values([{ hotelId: h.hotel.id, module: "invoicing", enabled: true }, { hotelId: h.hotel.id, module: "restaurant", enabled: true }, { hotelId: h.hotel.id, module: "pos", enabled: true }]).onConflictDoNothing();
  const email = `kds-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);
  const { addLines } = await import("../../src/services/pos");
  const item = await saveItem(h.hotel.id, null, { category: "Essen", name: "Rösti", priceRappen: 2150, vatDineInBps: 810, vatTakeawayBps: 260 }, "e2e");
  const dev = await createDevice(h.hotel.id, "T1", "Tablet", "e2e");
  const order = await openOrder(h.hotel.id, { tableId: null, deviceId: dev.id, label: "Bar" }, "e2e");
  await addLines(h.hotel, order.id, [{ itemId: item.id, quantity: 2, note: "mit Spiegelei" }], "e2e");
  await page.goto(`/admin/${h.hotel.id}/restaurant/kueche`);
  await expect(page.getByTestId("kds").getByText("2 × Rösti · mit Spiegelei")).toBeVisible();
  await page.getByRole("button", { name: "Alles fertig" }).click();
  await expect(page.getByText("Nichts offen.")).toBeVisible();
});

/** Tischplan und Reservierung (SPEC 19.49 Etappe C): Gast reserviert online, Personal sieht es, Gast storniert */
test("Reservierung: online buchen, Liste, Storno per Link; Plan zeigt Tisch", async ({ page, context, baseURL }) => {
  const h = await makeHotel();
  await db().insert(hotelModules).values([{ hotelId: h.hotel.id, module: "invoicing", enabled: true }, { hotelId: h.hotel.id, module: "restaurant", enabled: true }, { hotelId: h.hotel.id, module: "pos", enabled: true }]).onConflictDoNothing();
  const email = `res-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(h.hotel.id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);
  const { saveTable, saveTablePlan, listTables } = await import("../../src/services/pos");
  const { saveSettings } = await import("../../src/services/reservations");
  const { addDays, todayIn } = await import("../../src/domain/dates");
  await saveTable(h.hotel.id, "Tisch 1", "e2e");
  const [t] = await listTables(h.hotel.id);
  await saveTablePlan(h.hotel.id, [{ id: t.id, x: 300, y: 300 }], "e2e");
  const day = addDays(todayIn(h.hotel.timezone), 5);

  // Gast: Online aus → Hinweis; dann an
  await page.goto(`/h/${h.hotel.slug}/de/tisch`);
  await expect(page.getByText("Online-Reservierung ist hier nicht möglich")).toBeVisible();
  await saveSettings(h.hotel.id, { onlineEnabled: true, windows: [{ from: "18:00", to: "20:00" }], durationMin: 90, maxParty: 6, capacity: 20, leadHours: 0, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 24, autoAssign: true }, "e2e");
  await page.goto(`/h/${h.hotel.slug}/de/tisch?date=${day}&party=2`);
  const form = page.getByTestId("reserve-form");
  await form.getByLabel("Name").fill("Frau Muster");
  await form.getByLabel("E-Mail").fill("muster@example.ch");
  await form.getByRole("button", { name: "Verbindlich reservieren" }).click();
  await expect(page.getByRole("heading", { name: "Ihr Tisch ist reserviert." })).toBeVisible();
  const link = page.url();

  // Personal sieht die Reservierung und setzt den Tisch
  await page.goto(`/admin/${h.hotel.id}/restaurant/reservierungen?day=${day}`);
  const list = page.getByTestId("res-list");
  await expect(list.getByText("Frau Muster")).toBeVisible();
  await list.getByLabel("Tisch Frau Muster").selectOption({ label: "Tisch 1 (2)" });
  await list.getByRole("button", { name: "Setzen" }).click();
  await expect(page.getByText("Tisch zugewiesen")).toBeVisible();
  await page.goto(`/admin/${h.hotel.id}/restaurant`);
  await expect(page.getByTestId("plan-area").getByText("Tisch 1")).toBeVisible();

  // Gast storniert
  await page.goto(link.replace("?new=1", ""));
  await page.getByRole("button", { name: "Reservierung stornieren" }).click();
  await expect(page.getByRole("heading", { name: "Die Reservierung wurde storniert." })).toBeVisible();
});
