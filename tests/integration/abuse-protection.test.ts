import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "../../src/db/client";
import { rateLimitDb } from "../../src/lib/rate-limit-db";
import { setTurnstileFetch, verifyTurnstile } from "../../src/integrations/turnstile";
import { limitByIpAndEmail } from "../../src/lib/public-form";
import { DisposableEmailError, registerHost } from "../../src/services/onboarding";

afterAll(closeDb);
const uid = () => Math.random().toString(36).slice(2, 9);

describe("Rate-Limit in der Datenbank", () => {
  it("erlaubt bis zur Grenze, blockt danach, öffnet im neuen Zeitfenster wieder", async () => {
    const key = `t-${uid()}`;
    const t0 = new Date("2026-01-01T10:00:00Z");
    for (let i = 0; i < 3; i++) expect(await rateLimitDb(key, 3, 60_000, t0)).toBe(true);
    expect(await rateLimitDb(key, 3, 60_000, new Date(t0.getTime() + 30_000))).toBe(false);
    expect(await rateLimitDb(key, 3, 60_000, new Date(t0.getTime() + 61_000))).toBe(true); // neues Fenster
  });
  it("parallele Anfragen werden korrekt gezählt", async () => {
    const key = `p-${uid()}`;
    const r = await Promise.all(Array.from({ length: 10 }, () => rateLimitDb(key, 4, 60_000)));
    expect(r.filter(Boolean)).toHaveLength(4);
  });
  it("je IP und je E-Mail getrennt; die E-Mail-Grenze gilt auch über wechselnde IPs", async () => {
    const mail = `v-${uid()}@example.ch`;
    const o = { ipLimit: 100, ipWindowMs: 60_000, emailLimit: 2, emailWindowMs: 60_000 };
    expect(await limitByIpAndEmail("t", `ip-${uid()}`, mail, o)).toBe(true);
    expect(await limitByIpAndEmail("t", `ip-${uid()}`, mail.toUpperCase(), o)).toBe(true);
    expect(await limitByIpAndEmail("t", `ip-${uid()}`, mail, o)).toBe(false);
    expect(await limitByIpAndEmail("t", `ip-${uid()}`, `other-${uid()}@example.ch`, o)).toBe(true);
  });
});

describe("Turnstile (Siteverify)", () => {
  it("ohne Schlüssel aus; mit Schlüssel prüft er Erfolg und Hostname, fail-closed bei Fehler", async () => {
    expect(await verifyTurnstile(undefined)).toBe(true); // nicht konfiguriert (Test-Umgebung)
    const prev = { s: process.env.TURNSTILE_SITE_KEY, k: process.env.TURNSTILE_SECRET_KEY };
    process.env.TURNSTILE_SITE_KEY = "site"; process.env.TURNSTILE_SECRET_KEY = "secret";
    try {
      let body = "";
      setTurnstileFetch(async (_u, init) => { body = init.body; return { ok: true, json: async () => ({ success: true, hostname: "localhost" }) }; });
      expect(await verifyTurnstile("tok", "1.2.3.4")).toBe(true);
      expect(body).toContain("secret=secret"); expect(body).toContain("response=tok"); expect(body).toContain("remoteip=1.2.3.4");
      expect(await verifyTurnstile("")).toBe(false); // kein Token
      setTurnstileFetch(async () => ({ ok: true, json: async () => ({ success: false }) }));
      expect(await verifyTurnstile("tok")).toBe(false);
      setTurnstileFetch(async () => { throw new Error("offline"); });
      expect(await verifyTurnstile("tok")).toBe(false);
    } finally {
      setTurnstileFetch(null);
      if (prev.s === undefined) delete process.env.TURNSTILE_SITE_KEY; else process.env.TURNSTILE_SITE_KEY = prev.s;
      if (prev.k === undefined) delete process.env.TURNSTILE_SECRET_KEY; else process.env.TURNSTILE_SECRET_KEY = prev.k;
    }
  });
});

describe("Registrierung mit Wegwerf-Adresse", () => {
  it("wird abgelehnt, ohne Konto anzulegen", async () => {
    await expect(registerHost({ propertyType: "apartment", name: "Chalet X", contactName: "R K", email: `x-${uid()}@mailinator.com`, canton: "GR", municipality: "Dorf", acceptTerms: true } as never)).rejects.toBeInstanceOf(DisposableEmailError);
  });
});
