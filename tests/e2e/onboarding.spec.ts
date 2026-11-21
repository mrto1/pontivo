import { expect, test } from "@playwright/test";

/** Gastgeber registriert sich und richtet eine Ferienwohnung bis zum Live-Gang ein (Fake-Zahlung, ohne Mailversand). */
test("Selbst-Registrierung und Einrichtungs-Assistent bis live", async ({ page, browser }) => {
  const id = Math.random().toString(36).slice(2, 8);
  await page.goto("/registrieren");
  await page.getByLabel("Ferienwohnung").check();
  await page.fill("#name", `Ferienwohnung Alpenrose ${id}`);
  await page.selectOption("#canton", "GR");
  await page.fill("#municipality", `Testdorf ${id}`);
  await page.fill("#contactName", "Ruth Keller");
  await page.fill("#email", `ruth-${id}@example.ch`);
  await page.locator("input[name=terms]").check();
  await page.waitForTimeout(3200); // Mindestzeit des Formular-Schutzes (Bots senden sofort)
  await page.getByRole("button", { name: /Registrieren und Login-Link/ }).click();
  await expect(page.getByRole("heading", { name: "Fast geschafft" })).toBeVisible();
  await page.getByRole("link", { name: "Hier anmelden" }).click();

  // Nach dem Login: volles Menü, Einrichtungskarte, Hinweise auf jeder Seite; Konto über den Avatar
  await expect(page.getByRole("heading", { name: "Willkommen bei myPontivo" })).toBeVisible();
  await expect(page.locator(".admin-nav").getByRole("link", { name: "Kalender" })).toBeVisible();
  await expect(page.locator(".avatar-link")).toHaveText("RK");
  await expect(page.locator(".setup-chip")).toContainText("Einrichtung");
  await page.locator(".admin-nav").getByRole("link", { name: "Kalender" }).click();
  await expect(page.locator(".setup-banner")).toContainText("noch nicht abgeschlossen");
  await expect(page.locator(".setup-need")).toContainText("Zimmer");
  await page.locator(".setup-banner").getByRole("link", { name: "Einrichtung fortsetzen" }).click();

  // Assistent: Angaben
  await expect(page.getByRole("heading", { name: "Angaben zum Betrieb" })).toBeVisible();
  await page.fill("#addressLine", "Promenade 12");
  await page.fill("#postalCode", "7270");
  await page.fill("#city", "Davos");
  await page.fill("#intro", "Helle 3½-Zimmer-Wohnung mit Balkon, 5 Minuten zur Parsennbahn.");
  await page.getByRole("button", { name: "Speichern und weiter" }).click();

  // Was brauchen Sie? (Ferienwohnung: ohne Rezeption vorbelegt)
  await expect(page.getByRole("heading", { name: "Was brauchen Sie?" })).toBeVisible();
  await expect(page.getByLabel(/Wir haben eine Rezeption/)).not.toBeChecked();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();

  // Bisherige Software: Nein (Standard)
  await expect(page.getByRole("heading", { name: "Bisherige Software" })).toBeVisible();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();

  // Kurtaxe: Gemeinde unbekannt → eintragen
  await expect(page.getByRole("heading", { name: "Kurtaxe" })).toBeVisible();
  await page.fill("input[name=adult]", "3.50");
  await page.getByRole("button", { name: "Satz bestätigen" }).click();

  // Wohnung und Preise
  await expect(page.getByRole("heading", { name: "Wohnung und Preise" })).toBeVisible();
  await page.fill("input[name=name]", "Wohnung Alpenrose");
  await page.fill("input[name=maxPersons]", "4");
  await page.fill("input[name=price]", "190");
  await page.fill("input[name=cleaning]", "90");
  await page.locator("input[name=arrival][value='6']").check();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();

  // Fotos
  await expect(page.getByRole("heading", { name: "Fotos" })).toBeVisible();
  const img = await browser.newPage({ viewport: { width: 640, height: 400 } });
  await img.setContent(`<div style="width:640px;height:400px;background:linear-gradient(160deg,#9cc3e6,#f4e6c8 60%,#6b8f5e)"></div>`);
  const png = await img.screenshot();
  await img.close();
  await page.setInputFiles("input[type=file]", { name: "aussicht.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Hochladen" }).click();
  await expect(page.getByText("1 Foto(s) hochgeladen")).toBeVisible();
  // Zweites Foto hochladen und per Drag & Drop an die erste Stelle ziehen (wird automatisch Titelbild)
  await page.setInputFiles("input[type=file]", { name: "zimmer.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Hochladen" }).click();
  await expect(page.locator("figure.photo")).toHaveCount(2);
  await expect(page.locator("figure.photo").nth(0).locator(".badge")).toHaveText("Titelbild");
  await page.waitForLoadState("networkidle"); // Seite ist bedienbar (Handler angehängt), bevor gezogen wird
  const second = (await page.locator("figure.photo").nth(1).locator("img").getAttribute("src"))!;
  const from = (await page.locator("figure.photo").nth(1).boundingBox())!;
  const to = (await page.locator("figure.photo").nth(0).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText("Reihenfolge gespeichert")).toBeVisible();
  await expect(page.locator("figure.photo").nth(0).locator("img")).toHaveAttribute("src", second);
  await expect(page.locator("figure.photo").nth(0).locator(".badge")).toHaveText("Titelbild");
  await page.getByRole("button", { name: "Weiter" }).click();

  // Ankunft
  await expect(page.getByRole("heading", { name: "Infos zur Ankunft" })).toBeVisible();
  await page.fill("#ai-de", "Schlüsselbox neben der Tür, Code 2580.");
  await page.getByRole("button", { name: "Speichern und weiter" }).click();

  // Karte (Fake: sofort hinterlegt)
  await expect(page.getByRole("heading", { name: "Grundgebühr: Karte oder QR-Rechnung" })).toBeVisible();
  await page.getByRole("button", { name: "Karte hinterlegen" }).click();
  await expect(page.getByText("Karte hinterlegt: Testkarte •••• 4242")).toBeVisible();
  await page.getByRole("button", { name: "Weiter" }).click();

  // Live
  await expect(page.getByRole("heading", { name: "Online gehen" })).toBeVisible();
  await page.getByRole("button", { name: "Jetzt online gehen" }).click();
  await expect(page.getByText("ist online und buchbar")).toBeVisible();
});
