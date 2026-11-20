import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../../deploy/${f}`, import.meta.url), "utf8");

describe("Deploy-Konfiguration: Prod und int dürfen sich nie vermischen", () => {
  it("Caddy spricht prod und int mit eindeutigen Namen an (der Dienstname «app» gilt im gemeinsamen Netzwerk für beide)", () => {
    const caddy = read("Caddyfile");
    expect(caddy.match(/(?<![\w-])app:3000/g)).toBeNull();
    expect(caddy).toContain("reverse_proxy prod-app:3000");
    expect(caddy).toContain("reverse_proxy int-app:3000");
    expect(read("docker-compose.prod.yml")).toMatch(/aliases: \[prod-app\]/);
    expect(read("docker-compose.int.yml")).toMatch(/aliases: \[int-app\]/);
  });
  it("deploy.sh erzeugt Caddy neu (die Datei Caddyfile wird von git ersetzt) und verweigert Test-Einstellungen in der Produktion", () => {
    const d = read("deploy.sh");
    expect(d).toContain("up -d --force-recreate caddy");
    expect(d).toContain("ENVIRONMENT_LABEL|MAIL_REDIRECT_TO");
  });
});
