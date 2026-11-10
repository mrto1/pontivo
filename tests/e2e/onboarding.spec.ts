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
  await page.getByRole("button", { name: /Registrieren und Login-Link/ }).click();
  await expect(page.getByRole("heading", { name: "Fast geschafft" })).toBeVisible();
  await page.getByRole("link", { name: "Hier anmelden" }).click();

  // Assistent: Angaben
  await expect(page.getByRole("heading", { name: "Angaben zum Betrieb" })).toBeVisible();
  await page.fill("#addressLine", "Promenade 12");
  await page.fill("#postalCode", "7270");
  await page.fill("#city", "Davos");
  await page.fill("#intro", "Helle 3½-Zimmer-Wohnung mit Balkon, 5 Minuten zur Parsennbahn.");
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
  await page.getByRole("button", { name: "Weiter" }).click();

  // Ankunft
  await expect(page.getByRole("heading", { name: "Infos zur Ankunft" })).toBeVisible();
  await page.fill("#ai-de", "Schlüsselbox neben der Tür, Code 2580.");
  await page.getByRole("button", { name: "Speichern und weiter" }).click();

  // Karte (Fake: sofort hinterlegt)
  await expect(page.getByRole("heading", { name: "Karte für die Grundgebühr" })).toBeVisible();
  await page.getByRole("button", { name: "Karte hinterlegen" }).click();
  await expect(page.getByText("Karte hinterlegt: Testkarte •••• 4242")).toBeVisible();
  await page.getByRole("button", { name: "Weiter" }).click();

  // Live
  await expect(page.getByRole("heading", { name: "Online gehen" })).toBeVisible();
  await page.getByRole("button", { name: "Jetzt online gehen" }).click();
  await expect(page.getByText("ist online und buchbar")).toBeVisible();
});
