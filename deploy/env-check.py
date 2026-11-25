#!/usr/bin/env python3
"""
Prüft eine Umgebungsdatei (.env.production / .env.int) gegen den Code und räumt sie auf.
Zeigt nie Werte an, nur Namen und Art der Probleme.

  python3 deploy/env-check.py deploy/.env.production            # prüfen
  python3 deploy/env-check.py deploy/.env.int --env int        # Testumgebung
  python3 deploy/env-check.py deploy/.env.production --write   # zusätzlich aufgeräumte Kopie <datei>.neu schreiben

Die Datei selbst wird nie verändert. Nach dem Prüfen der Kopie: `mv datei.neu datei`, danach ./deploy.sh.
"""
import os, re, stat, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read(p):
    try:
        with open(p, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""

def walk(dirs, exts):
    for d in dirs:
        for base, names, files in os.walk(os.path.join(ROOT, d)):
            names[:] = [n for n in names if n not in ("node_modules", ".next", ".git", "data")]
            for f in files:
                if f.endswith(exts):
                    yield os.path.join(base, f)

def known_keys():
    """Alle Namen, die Code oder Docker-Dateien wirklich lesen."""
    keys = set(re.findall(r"^\s*([A-Z][A-Z0-9_]+)\s*:\s*z\.", read(os.path.join(ROOT, "src/env.ts")), re.M))
    for p in walk(["src", "app", "scripts", "components"], (".ts", ".tsx", ".mts")):
        t = read(p)
        keys |= set(re.findall(r"process\.env\.([A-Z][A-Z0-9_]+)", t))
        keys |= set(re.findall(r"raw\.([A-Z][A-Z0-9_]+)", t))
    for f in os.listdir(ROOT):  # Konfigurationsdateien im Hauptordner (vitest, playwright, drizzle, next)
        if f.endswith((".ts", ".mts", ".js", ".mjs", ".cjs")):
            t = read(os.path.join(ROOT, f))
            keys |= set(re.findall(r"process\.env\.([A-Z][A-Z0-9_]+)", t))
    for p in walk(["deploy"], (".yml", ".yaml", "Caddyfile", ".sh")):
        keys |= set(re.findall(r"\$\{([A-Z][A-Z0-9_]+)", read(p)))
    keys |= {"ALLOW_FAKE_PAYMENTS"}
    return keys

# Werden von Docker Compose selbst gesetzt: in der .env überflüssig und irreführend
SET_BY_DOCKER = {"DATABASE_URL", "NODE_ENV", "UPLOAD_DIR", "HOSTNAME", "PORT", "ACCOUNTING_EXPORT_DIR"}
# Nur für die Entwicklung auf dem eigenen Rechner
DEV_ONLY = {"SEED_ADMIN_EMAIL", "DEMO_HOTEL_SLUG"}

def parse(text):
    """-> Liste (Zeilennummer, Name, Wert, Rohzeile) und Liste aller Zeilen"""
    items = []
    for i, line in enumerate(text.splitlines(), 1):
        m = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$", line)
        if m and not line.lstrip().startswith("#"):
            v = m.group(2).strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            items.append((i, m.group(1), v, line))
    return items

def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    write = "--write" in argv
    mode = "int" if "--env" in argv and argv[argv.index("--env") + 1] == "int" else "prod"
    if not args:
        print(__doc__); return 2
    path = args[0]
    if mode == "prod" and "int" in os.path.basename(path):
        mode = "int"
    text = read(path)
    if not text:
        print(f"Datei {path} nicht lesbar oder leer."); return 2
    items = parse(text)
    cfg, dups = {}, []
    for _, k, v, _l in items:
        if k in cfg: dups.append(k)
        cfg[k] = v
    known = known_keys()
    errors, warns, unused, missing = [], [], [], []
    get = lambda k: cfg.get(k, "")
    prod = mode == "prod"
    # int: docker-compose.int.yml setzt SMTP_URL (Mailpit) selbst, dann braucht die .env.int weder Umleitung noch Postmark
    smtp = bool(get("SMTP_URL")) or (not prod and "SMTP_URL:" in read(os.path.join(ROOT, "deploy/docker-compose.int.yml")))

    # Gefährliche Kombinationen
    if get("PAYMENT_PROVIDER") == "fake": errors.append("PAYMENT_PROVIDER=fake: Buchungen würden ohne Zahlung bestätigt.")
    sk = get("STRIPE_SECRET_KEY")
    if prod and sk.startswith("sk_test_"): errors.append("STRIPE_SECRET_KEY ist ein Testschlüssel (sk_test_…) in der Produktion.")
    if prod and sk and not sk.startswith(("sk_live_", "rk_live_")) and not sk.startswith("sk_test_"): warns.append("STRIPE_SECRET_KEY hat ein unbekanntes Format.")
    if not prod and sk.startswith(("sk_live_", "rk_live_")): errors.append("STRIPE_SECRET_KEY ist ein Live-Schlüssel in der Testumgebung.")
    base = get("APP_BASE_URL")
    if prod and (not base.startswith("https://") or "localhost" in base): errors.append("APP_BASE_URL muss in der Produktion eine https-Adresse sein (kein localhost).")
    if prod and get("MAIL_REDIRECT_TO"): errors.append("MAIL_REDIRECT_TO ist gesetzt: alle Mails gingen an diese Adresse statt an Gäste (nur für die Testumgebung).")
    if prod and get("ENVIRONMENT_LABEL"): errors.append("ENVIRONMENT_LABEL ist gesetzt: die Seite würde als Testumgebung markiert und nicht indexiert.")
    if prod and get("SMTP_URL"): errors.append("SMTP_URL ist gesetzt: Mails würden nur in einem Mail-Fänger landen statt bei den Gästen (nur für die Testumgebung).")
    if not prod and not smtp and not get("MAIL_REDIRECT_TO"): errors.append("MAIL_REDIRECT_TO fehlt: die Testumgebung könnte echte Gäste anschreiben (oder SMTP_URL für Mailpit setzen).")
    if not prod and not get("ENVIRONMENT_LABEL"): warns.append("ENVIRONMENT_LABEL fehlt: die Testumgebung ist nicht als solche erkennbar.")
    if prod and "staging.channex.io" in get("CHANNEX_BASE_URL"): warns.append("CHANNEX_BASE_URL zeigt auf die Channex-Testumgebung (staging).")
    if get("EMAIL_FROM") and get("EMAIL_FROM").endswith("@example.ch"): warns.append("EMAIL_FROM ist noch die Beispieladresse.")
    for a, b in (("TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"), ("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY")):
        if bool(get(a)) != bool(get(b)): warns.append(f"{a} und {b} gehören zusammen: nur einer ist gesetzt, die Funktion bleibt aus.")
    if get("AUTH_SECRET") and len(get("AUTH_SECRET")) < 32: warns.append("AUTH_SECRET ist kurz (empfohlen: openssl rand -hex 32).")
    if get("GUEST_DATA_KEY"):
        import base64
        try:
            if len(base64.b64decode(get("GUEST_DATA_KEY"), validate=True)) != 32: warns.append("GUEST_DATA_KEY ist kein 32-Byte-Schlüssel (openssl rand -base64 32).")
        except Exception:
            warns.append("GUEST_DATA_KEY ist kein gültiges Base64 (openssl rand -base64 32).")

    # Fehlende Einträge
    need = ["POSTGRES_PASSWORD", "APP_DOMAIN", "ACME_EMAIL", "AUTH_SECRET", "APP_BASE_URL", "PAYMENT_PROVIDER", "STRIPE_SECRET_KEY",
            "STRIPE_WEBHOOK_SECRET_CONNECT", "EMAIL_FROM", "PLATFORM_ALERT_EMAIL"]
    if not smtp: need.append("POSTMARK_SERVER_TOKEN")
    if prod: need += ["PLATFORM_UID", "GUEST_DATA_KEY", "HOSTING_PROVIDER"]
    for k in need:
        if not get(k): missing.append(k)

    # Unbenutzte, von Docker gesetzte, Entwicklungs- und doppelte Einträge
    for _, k, v, _l in items:
        if k in SET_BY_DOCKER: unused.append((k, "wird von Docker Compose gesetzt, hier überflüssig"))
        elif k in DEV_ONLY and prod: unused.append((k, "nur für die Entwicklung"))
        elif k not in known: unused.append((k, "wird von keiner Stelle im Code gelesen"))
        elif v == "": unused.append((k, "leer (gleich wie nicht gesetzt)"))
    for k in sorted(set(dups)): warns.append(f"{k} steht mehrfach drin (es zählt der letzte Eintrag).")
    try:
        mode_bits = stat.S_IMODE(os.stat(path).st_mode)
        if mode_bits & 0o077: warns.append(f"Dateirechte {oct(mode_bits)[2:]}: andere Benutzer können die Datei lesen (chmod 600).")
    except OSError:
        pass

    def out(title, rows, sym):
        if rows:
            print(f"\n{title}")
            for r in rows: print(f"  {sym} {r}")
    print(f"Prüfung {path} ({'Produktion' if prod else 'Testumgebung'}): {len(items)} Einträge")
    out("FEHLER (beheben):", errors, "✗")
    out("FEHLT:", missing, "−")
    out("HINWEISE:", warns, "!")
    out("ÜBERFLÜSSIG (können raus):", [f"{k}: {why}" for k, why in unused], "○")
    if not (errors or missing or warns or unused): print("\nAlles in Ordnung.")

    if write:
        drop = {k for k, _ in unused if k not in missing}
        seen_last = {}
        for i, k, _v, _l in items: seen_last[k] = i
        dead = {i for i, k, v, _l in items if k in drop or seen_last[k] != i}
        lines = text.splitlines()
        kept = [l for n, l in enumerate(lines, 1) if n not in dead]
        # Verwaiste Kommentarblöcke ohne folgende Einstellung stehen lassen (Beispiel-Kommentare), nur doppelte Leerzeilen zusammenziehen
        res, blank = [], False
        for l in kept:
            if not l.strip():
                if blank: continue
                blank = True
            else:
                blank = False
            res.append(l)
        newp = path + ".neu"
        with open(newp, "w", encoding="utf-8") as f: f.write("\n".join(res).rstrip("\n") + "\n")
        os.chmod(newp, 0o600)
        print(f"\nAufgeräumte Kopie geschrieben: {newp} ({len(dead)} Zeilen entfernt). Vergleichen mit: diff {path} {newp}")
    return 1 if errors else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
