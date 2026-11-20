import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(process.cwd(), "deploy/env-check.py");
const run = (file: string, ...extra: string[]) => spawnSync("python3", [SCRIPT, file, ...extra], { encoding: "utf8" });

describe("deploy/env-check.py", () => {
  it("meldet gefährliche Werte, Überflüssiges und Doppeltes, nie Werte", () => {
    const dir = mkdtempSync(join(tmpdir(), "envcheck-"));
    try {
      const f = join(dir, ".env.production");
      writeFileSync(f, [
        "POSTGRES_PASSWORD=supergeheim-pw", "APP_DOMAIN=pontivo.ch", "ACME_EMAIL=a@b.ch", "AUTH_SECRET=kurz",
        "APP_BASE_URL=http://localhost:3000", "PAYMENT_PROVIDER=fake", "STRIPE_SECRET_KEY=sk_test_abc123geheim",
        "MAIL_REDIRECT_TO=test@x.ch", "NODE_ENV=production", "ALTER_SCHLUESSEL=xyz", "EMAIL_FROM=ok@pontivo.ch", "EMAIL_FROM=ok2@pontivo.ch", "",
      ].join("\n"), { mode: 0o644 });
      const r = run(f);
      expect(r.status).toBe(1); // Fehler vorhanden
      const o = r.stdout;
      expect(o).toContain("PAYMENT_PROVIDER=fake");
      expect(o).toContain("sk_test_");
      expect(o).toContain("APP_BASE_URL muss");
      expect(o).toContain("MAIL_REDIRECT_TO ist gesetzt");
      expect(o).toContain("ALTER_SCHLUESSEL");
      expect(o).toContain("NODE_ENV: wird von Docker Compose gesetzt");
      expect(o).toContain("EMAIL_FROM steht mehrfach");
      expect(o).toContain("STRIPE_WEBHOOK_SECRET_CONNECT"); // fehlt
      expect(o).not.toContain("supergeheim-pw");
      expect(o).not.toContain("abc123geheim");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("saubere Produktionsdatei: Status 0; --write entfernt nur Überflüssiges und lässt das Original unberührt", () => {
    const dir = mkdtempSync(join(tmpdir(), "envcheck-"));
    try {
      const f = join(dir, ".env.production");
      const body = [
        "POSTGRES_PASSWORD=pw", "APP_DOMAIN=pontivo.ch", "ACME_EMAIL=a@b.ch", `AUTH_SECRET=${"a".repeat(40)}`, "APP_BASE_URL=https://pontivo.ch",
        "PAYMENT_PROVIDER=stripe", "STRIPE_SECRET_KEY=sk_live_x", "STRIPE_WEBHOOK_SECRET_CONNECT=whsec_x", "POSTMARK_SERVER_TOKEN=t",
        "EMAIL_FROM=buchung@pontivo.ch", "PLATFORM_ALERT_EMAIL=a@pontivo.ch", "PLATFORM_UID=CHE-1", `GUEST_DATA_KEY=${Buffer.alloc(32, 1).toString("base64")}`, "HOSTING_PROVIDER=Infomaniak",
      ].join("\n") + "\n";
      writeFileSync(f, body + "ALTER_SCHLUESSEL=xyz\n", { mode: 0o600 });
      const r = run(f, "--write");
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("ALTER_SCHLUESSEL");
      expect(readFileSync(f, "utf8")).toContain("ALTER_SCHLUESSEL"); // Original unverändert
      expect(existsSync(f + ".neu")).toBe(true);
      expect(readFileSync(f + ".neu", "utf8")).toBe(body);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("Testumgebung verlangt Mail-Umleitung, Live-Schlüssel ist ein Fehler", () => {
    const dir = mkdtempSync(join(tmpdir(), "envcheck-"));
    try {
      const f = join(dir, ".env.int");
      writeFileSync(f, "STRIPE_SECRET_KEY=sk_live_x\nPAYMENT_PROVIDER=stripe\n", { mode: 0o600 });
      const r = run(f);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("Live-Schlüssel in der Testumgebung");
      expect(r.stdout).toContain("MAIL_REDIRECT_TO fehlt");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
