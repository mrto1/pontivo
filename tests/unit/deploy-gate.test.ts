import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GATE = join(process.cwd(), "deploy/deploy-gate.sh");
const USER = join(process.cwd(), "deploy/deploy-user.sh");
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTestsOnly1234567890abcdefgh anna@laptop";

let dir: string;
let env: Record<string, string>;

function user(args: string[], password = "geheim-passwort-1") {
  return spawnSync("bash", [USER, ...args], {
    env: { ...process.env, ...env, PONTIVO_TEST: "1", PONTIVO_DEPLOY_PASSWORD: password },
    encoding: "utf8",
  });
}
function gate(name: string, action: string, stdin: string) {
  return spawnSync("bash", [GATE, name], {
    env: { ...process.env, ...env, SSH_ORIGINAL_COMMAND: action },
    input: stdin,
    encoding: "utf8",
  });
}
const shipCalls = () => (existsSync(join(dir, "ship.calls")) ? readFileSync(join(dir, "ship.calls"), "utf8").trim() : "");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deploygate-"));
  const ship = join(dir, "ship.sh");
  writeFileSync(ship, `#!/usr/bin/env bash\necho "$1" >> "${dir}/ship.calls"\necho "ship $1 ok"\n`);
  chmodSync(ship, 0o755);
  env = {
    PONTIVO_DEPLOY_DB: join(dir, "users"),
    PONTIVO_DEPLOY_LOG: join(dir, "deploy.log"),
    PONTIVO_AUTH_FILE: join(dir, "authorized_keys"),
    PONTIVO_SHIP: ship,
    PONTIVO_DEPLOY_LOCK: join(dir, "lock"),
    PONTIVO_FAIL_DELAY: "0",
    PONTIVO_GATE: "/opt/pontivo-int/deploy/deploy-gate.sh",
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("deploy-user.sh", () => {
  it("legt Person an: Hash (nicht Klartext) und eingeschränkter Schlüssel", () => {
    const r = user(["add", "anna", KEY]);
    expect(r.status).toBe(0);
    const db = readFileSync(env.PONTIVO_DEPLOY_DB, "utf8");
    expect(db).toMatch(/^anna:\$6\$[0-9a-f]+\$/);
    expect(db).not.toContain("geheim-passwort-1");
    const auth = readFileSync(env.PONTIVO_AUTH_FILE, "utf8");
    expect(auth).toContain('restrict,command="sudo -n /opt/pontivo-int/deploy/deploy-gate.sh anna" ssh-ed25519 AAAA');
    expect(auth).toContain("pontivo-deploy:anna");
  });

  it("lehnt ungültige Namen, kurze Passwörter und kaputte Schlüssel ab", () => {
    expect(user(["add", "Anna Muster", KEY]).status).not.toBe(0);
    expect(user(["add", "anna", KEY], "kurz").status).not.toBe(0);
    expect(user(["add", "anna", 'ssh-ed25519 AAAA" ; rm -rf /']).status).not.toBe(0);
    expect(user(["add", "anna", "kein schluessel"]).status).not.toBe(0);
    expect(existsSync(env.PONTIVO_DEPLOY_DB)).toBe(false);
  });

  it("doppelter Name wird abgelehnt, passwd ändert, remove entzieht, list zeigt", () => {
    expect(user(["add", "anna", KEY]).status).toBe(0);
    expect(user(["add", "anna", KEY]).status).not.toBe(0);
    expect(user(["list"]).stdout).toContain("anna");
    expect(user(["passwd", "anna"], "anderes-passwort-2").status).toBe(0);
    expect(gate("anna", "test", "anderes-passwort-2\n").status).toBe(0);
    expect(gate("anna", "test", "geheim-passwort-1\n").status).toBe(3);
    expect(user(["remove", "anna"]).status).toBe(0);
    expect(readFileSync(env.PONTIVO_DEPLOY_DB, "utf8")).not.toContain("anna");
    expect(readFileSync(env.PONTIVO_AUTH_FILE, "utf8")).not.toContain("anna");
  });

  it("remove entfernt nur die gemeinte Person", () => {
    user(["add", "anna", KEY]);
    user(["add", "martin", KEY.replace("anna@laptop", "martin@pc")], "martin-passwort-1");
    user(["remove", "anna"]);
    expect(readFileSync(env.PONTIVO_AUTH_FILE, "utf8")).toContain("pontivo-deploy:martin");
    expect(readFileSync(env.PONTIVO_DEPLOY_DB, "utf8")).toContain("martin:");
  });
});

describe("deploy-gate.sh", () => {
  beforeEach(() => {
    expect(user(["add", "anna", KEY]).status).toBe(0);
  });

  it("richtiges Passwort + int: ship.sh läuft genau mit «int»", () => {
    const r = gate("anna", "int", "geheim-passwort-1\n");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ship int ok");
    expect(shipCalls()).toBe("int");
  });

  it("prod wird nur mit richtigem Passwort ausgeführt", () => {
    expect(gate("anna", "prod", "falsch\n").status).toBe(3);
    expect(shipCalls()).toBe("");
    expect(gate("anna", "prod", "geheim-passwort-1\n").status).toBe(0);
    expect(shipCalls()).toBe("prod");
  });

  it("falsches, leeres oder fehlendes Passwort: Abbruch ohne Ausrollen", () => {
    expect(gate("anna", "int", "falsch\n").status).toBe(3);
    expect(gate("anna", "int", "\n").status).toBe(3);
    expect(gate("anna", "int", "").status).toBe(2);
    expect(shipCalls()).toBe("");
  });

  it("unbekannte Person: «Passwort falsch», nichts passiert", () => {
    const r = gate("bernd", "int", "geheim-passwort-1\n");
    expect(r.status).toBe(3);
    expect(r.stdout).toContain("Passwort falsch");
    expect(shipCalls()).toBe("");
  });

  it("nur die vier Aktionen; Einschleusen von Befehlen wird abgelehnt", () => {
    for (const a of ["", "bash", "int; id", "prod && id", "$(id)", "rm -rf /", "int prod"]) {
      const r = gate("anna", a, "geheim-passwort-1\n");
      expect(r.status).toBe(2);
    }
    expect(shipCalls()).toBe("");
  });

  it("ungültiger Name (Einschleusen über Parameter) wird abgelehnt", () => {
    expect(gate("anna:x", "int", "geheim-passwort-1\n").status).toBe(2);
    expect(gate("../etc", "int", "geheim-passwort-1\n").status).toBe(2);
    expect(gate("", "int", "geheim-passwort-1\n").status).toBe(2);
  });

  it("test-Aktion meldet Anmeldung, ohne auszurollen", () => {
    const r = gate("anna", "test", "geheim-passwort-1\n");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Angemeldet als anna");
    expect(shipCalls()).toBe("");
  });

  it("Protokoll enthält Person, Aktion und Fehlversuche, aber nie das Passwort", () => {
    gate("anna", "int", "falsch-versuch\n");
    gate("anna", "int", "geheim-passwort-1\n");
    const log = readFileSync(env.PONTIVO_DEPLOY_LOG, "utf8");
    expect(log).toMatch(/anna\s+FEHLER\s+Passwort falsch/);
    expect(log).toMatch(/anna\s+START\s+int/);
    expect(log).toMatch(/anna\s+ENDE\s+int Code 0/);
    expect(log).not.toContain("geheim-passwort-1");
    expect(log).not.toContain("falsch-versuch");
  });

  it("Passwort mit Sonderzeichen funktioniert", () => {
    const pw = "Pa$$ w'ö\"rt!`x`";
    expect(user(["passwd", "anna"], pw).status).toBe(0);
    expect(gate("anna", "test", pw + "\n").status).toBe(0);
  });
});
