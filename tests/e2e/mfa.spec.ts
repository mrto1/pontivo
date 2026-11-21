import { expect, test } from "@playwright/test";
import { totpCode, totpStep } from "../../src/domain/totp";

/** Passkey (virtueller Authenticator, Gerätesperre simuliert) und Authenticator-App (TOTP) vom Anlegen bis zur Anmeldung. */
test("Passkey und 2FA: einrichten, abmelden, anmelden", async ({ page, context }) => {
  const id = Math.random().toString(36).slice(2, 8);
  const email = `mfa-${id}@example.ch`;
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const authOptions = { protocol: "ctap2" as const, transport: "internal" as const, hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true };
  let { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: authOptions });

  // Das Autofill-Angebot (Conditional UI) würde mit simulierter Anwesenheit sofort anmelden; Browser warten dort auf die Auswahl.
  const presence = (enabled: boolean) => cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled });
  // Standard: Autofill-Angebot aus (der Knopf wird geprüft); am Ende einmal an (Autofill-Weg)
  await page.addInitScript(() => {
    // Ohne «cond» gilt das Gerät als unbekannt (kein Autostart des Passkeys), die Kachel wird per Klick geprüft
    if (!sessionStorage.getItem("cond")) { (PublicKeyCredential as unknown as { isConditionalMediationAvailable: () => Promise<boolean> }).isConditionalMediationAvailable = async () => false; localStorage.removeItem("pontivo.passkey"); }
  });
  const passkeyLogin = async () => {
    await presence(true);
    await page.goto("/admin/login");
    await page.getByTestId("passkey-login").click();
  };

  // Konto über die Registrierung anlegen
  await page.goto("/registrieren");
  await page.getByLabel("Ferienwohnung").check();
  await page.fill("#name", `Wohnung MFA ${id}`);
  await page.selectOption("#canton", "GR");
  await page.fill("#municipality", `Testdorf ${id}`);
  await page.fill("#contactName", "Ruth Keller");
  await page.fill("#email", email);
  await page.locator("input[name=terms]").check();
  await page.waitForTimeout(3200); // Mindestzeit des Formular-Schutzes (Bots senden sofort)
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
  await passkeyLogin();
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
  await presence(false);
  await page.goto("/admin/login?link=1");
  await page.fill("#email", email);
  await page.waitForTimeout(1100); // Mindestzeit des Formular-Schutzes
  await page.getByRole("button", { name: "Login-Link senden" }).click();
  await page.getByRole("link", { name: "Hier anmelden" }).click();
  await expect(page.getByRole("heading", { name: "Zweiter Faktor" })).toBeVisible();
  await page.goto("/admin"); // ohne 2. Faktor keine Sitzung
  await expect(page).toHaveURL(/\/admin\/login/);

  // falscher Code, dann Wiederherstellungscode
  await presence(false);
  await page.goto("/admin/login?link=1");
  await page.fill("#email", email);
  await page.waitForTimeout(1100); // Mindestzeit des Formular-Schutzes
  await page.getByRole("button", { name: "Login-Link senden" }).click();
  await page.getByRole("link", { name: "Hier anmelden" }).click();
  await page.fill("#code", "000000");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Der Code stimmt nicht")).toBeVisible();
  await page.fill("#code", recovery[0]);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/admin(?!\/login)/);

  // 2FA gilt auch für den Passkey-Weg: erst der Code, dann die Sitzung
  await context.clearCookies();
  await passkeyLogin();
  await expect(page.getByRole("heading", { name: "Zweiter Faktor" })).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await passkeyLogin();
  await page.fill("#code", recovery[1]);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/admin(?!\/login)/);

  // Nur Passkey: braucht 2 Passkeys, danach gibt es keinen E-Mail-Link mehr
  await page.goto("/admin/konto");
  await expect(page.getByRole("button", { name: /erst 2 Passkeys/ })).toBeDisabled();
  // zweites Gerät = zweiter virtueller Authenticator (das erste ist danach weg, wie ein verlorenes Handy)
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  ({ authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: authOptions }));
  await page.getByPlaceholder(/Name/).fill("Zweites Gerät");
  await page.getByTestId("passkey-add").click();
  await expect(page.getByText("Zweites Gerät")).toBeVisible();
  // nach dem Neuladen kann der Klick vor der Hydration verloren gehen: wiederholen, bis die Seite reagiert
  await expect(async () => {
    await page.getByRole("button", { name: "Nur Passkey erlauben" }).click({ timeout: 2000 });
    await expect(page.getByText("eingeschaltet. Passwort und E-Mail-Link funktionieren")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await context.clearCookies();
  await presence(false);
  await page.goto("/admin/login?link=1");
  await page.fill("#email", email);
  await page.waitForTimeout(1100); // Mindestzeit des Formular-Schutzes
  await page.getByRole("button", { name: "Login-Link senden" }).click();
  await expect(page.getByText("Falls die Adresse bei uns registriert ist")).toBeVisible();
  await expect(page.getByRole("link", { name: "Hier anmelden" })).toHaveCount(0);
  await presence(true);
  await page.goto("/admin/login");
  await page.getByTestId("passkey-login").click();
  await page.fill("#code", recovery[2]);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/admin(?!\/login)/);

  // Autostart: auf einem Gerät mit bekanntem Passkey meldet die Login-Seite beim Laden von selbst an (ohne Knopf)
  await context.clearCookies();
  await page.evaluate(() => sessionStorage.setItem("cond", "1"));
  await presence(true);
  await page.goto("/admin/login");
  await page.fill("#code", recovery[3]);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/admin(?!\/login)/);
});
