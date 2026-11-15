import { expect, test } from "@playwright/test";
import { totpCode, totpStep } from "../../src/domain/totp";

/** Passkey (virtueller Authenticator, Gerätesperre simuliert) und Authenticator-App (TOTP) vom Anlegen bis zur Anmeldung. */
test("Passkey und 2FA: einrichten, abmelden, anmelden", async ({ page, context }) => {
  const id = Math.random().toString(36).slice(2, 8);
  const email = `mfa-${id}@example.ch`;
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  // Konto über die Registrierung anlegen
  await page.goto("/registrieren");
  await page.getByLabel("Ferienwohnung").check();
  await page.fill("#name", `Wohnung MFA ${id}`);
  await page.selectOption("#canton", "GR");
  await page.fill("#municipality", `Testdorf ${id}`);
  await page.fill("#contactName", "Ruth Keller");
  await page.fill("#email", email);
  await page.locator("input[name=terms]").check();
  await page.getByRole("button", { name: /Registrieren und Login-Link/ }).click();
  await page.getByRole("link", { name: "Hier anmelden" }).click();
  await expect(page).toHaveURL(/\/admin/);

  // Passkey hinzufügen
  await page.goto("/admin/konto");
  await page.getByPlaceholder(/Name/).fill("Test-Gerät");
  await page.getByTestId("passkey-add").click();
  await expect(page.getByText("Test-Gerät")).toBeVisible();

  // Abmelden, mit Passkey anmelden (ohne E-Mail)
  await context.clearCookies();
  await page.goto("/admin/login");
  await page.getByTestId("passkey-login").click();
  await expect(page).toHaveURL(/\/admin(?!\/login)/);

  // Authenticator-App einrichten
  await page.goto("/admin/konto");
  await page.getByRole("button", { name: "Authenticator-App einrichten" }).click();
  const secret = (await page.locator("code").first().innerText()).trim();
  await page.getByTestId("totp-code").fill(totpCode(secret, totpStep(Date.now())));
  await page.getByTestId("totp-confirm").click();
  const recovery = (await page.getByTestId("recovery-codes").locator("pre").innerText()).split("\n");
  expect(recovery).toHaveLength(10);

  // Magic-Link verlangt jetzt den Code
  await context.clearCookies();
  await page.goto("/admin/login");
  await page.fill("#email", email);
  await page.getByRole("button", { name: "Login-Link senden" }).click();
  await page.getByRole("link", { name: "Hier anmelden" }).click();
  await expect(page.getByRole("heading", { name: "Zweiter Faktor" })).toBeVisible();
  await page.goto("/admin"); // ohne 2. Faktor keine Sitzung
  await expect(page).toHaveURL(/\/admin\/login/);

  // falscher Code, dann Wiederherstellungscode
  await page.goto("/admin/login");
  await page.fill("#email", email);
  await page.getByRole("button", { name: "Login-Link senden" }).click();
  await page.getByRole("link", { name: "Hier anmelden" }).click();
  await page.fill("#code", "000000");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Der Code stimmt nicht")).toBeVisible();
  await page.fill("#code", recovery[0]);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/admin(?!\/login)/);

  // Passkey-Anmeldung braucht trotz aktiver 2FA keinen Code
  await context.clearCookies();
  await page.goto("/admin/login");
  await page.getByTestId("passkey-login").click();
  await expect(page).toHaveURL(/\/admin(?!\/login)/);
});
