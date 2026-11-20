# Testumgebung int.pontivo.ch

Neue Funktionen zuerst auf int ausprobieren, dann erst auf prod. Zurück zur Übersicht: [DEPLOY.md](../DEPLOY.md).

## Das Prinzip

| | **int** (Test) | **prod** (echt) |
|---|---|---|
| Adresse | https://int.pontivo.ch (Passwortschutz) | https://pontivo.ch |
| Server | derselbe VPS, eigene Container und eigene Datenbank | |
| Ordner | `/opt/pontivo-int` | `/opt/pontivo` |
| Zahlung | Stripe **Testmodus** (Karte 4242 4242 4242 4242, TWINT-Test) | Stripe live |
| E-Mails | gehen **alle** an `MAIL_REDIRECT_TO` (nie an echte Gäste), Original im Betreff | normal |
| Daten | Testdaten, dürfen jederzeit gelöscht werden | echte Daten, tägliche Sicherung |
| Suchmaschinen | gesperrt, orangefarbener Hinweis «Testumgebung» unten links | offen |
| Code | neuester Stand (`main`) oder ein Branch | nur **freigegebene** Versionen (Tag `prod-…`) |

Der Weg einer Änderung: **Entwicklung → int ausrollen → testen → freigeben → prod ausrollen.** Auf prod kommt nie etwas, das nicht vorher auf int lief, weil `./deploy.sh` nur Versionen ausrollt, die mit `./release.sh` freigegeben wurden.

Ein eigener zweiter Server ist nicht nötig (zusätzliche Kosten, mehr Pflege). Wenn die Last auf dem VPS spürbar wird, kann int später auf einen eigenen kleinen VPS umziehen, die Skripte bleiben gleich.

## Einmalig einrichten

1. **DNS** (Infomaniak, Zone pontivo.ch): A-Eintrag `int` → IP des VPS. Hat der VPS eine IPv6-Adresse, zusätzlich AAAA-Eintrag `int` → diese IPv6; sonst darf für `int` kein AAAA existieren (auch kein Platzhalter `*`, der auf das alte Webhosting zeigt).
2. **Code holen** (auf dem Server **als root**: zuerst `sudo -i`, sonst meldet git «Permission denied», weil `/opt` root gehört; danach gelten alle Befehle dieses Abschnitts als root, ein `sudo` davor ist dann nicht nötig):
   ```bash
   sudo -i
   git clone https://github.com/mrto1/pontivo.git /opt/pontivo-int
   cd /opt/pontivo-int/deploy
   cp .env.int.example .env.int
   nano .env.int
   ```
   Zufallswerte mit `openssl rand -hex 32` (`POSTGRES_PASSWORD`, `AUTH_SECRET`) und `openssl rand -base64 32` (`GUEST_DATA_KEY`). **Nie** die Werte aus `.env.production` kopieren. Stripe nur mit Testschlüsseln, `MAIL_REDIRECT_TO` auf eine eigene Adresse (z. B. test@pontivo.ch), Postmark-Token darf derselbe sein.
3. **Passwortschutz** (im Ordner der Produktion, weil dort Caddy läuft):
   ```bash
   cd /opt/pontivo/deploy      # das Skript liegt in jeder freigegebenen Version; fehlt es, zuerst einmal den Weg int → release → prod gehen
   ./int-password.sh martin
   ```
   Mit diesem Benutzer und Passwort öffnet man int im Browser. Webhooks (Stripe, Postmark, Channex) sind davon ausgenommen.
4. **Erstmals ausrollen**: `cd /opt/pontivo-int/deploy && ./deploy-int.sh`. Danach einmalig den Demo-Betrieb anlegen:
   `docker compose --env-file .env.int -f docker-compose.int.yml exec app node --import tsx scripts/seed.ts`
   und sich als Plattform-Admin anlegen wie in [Schritt 6 der Erstinstallation](1-erstinstallation.md#schritt-6-dich-als-plattform-admin-anlegen), aber mit `--env-file .env.int -f docker-compose.int.yml`, also: `docker compose --env-file .env.int -f docker-compose.int.yml exec app node --import tsx scripts/create-admin.ts du@pontivo.ch "Vorname Name"`.
5. **Stripe-Testmodus**: im Stripe-Dashboard (Testmodus) einen Webhook für Connected accounts auf `https://int.pontivo.ch/api/webhooks/stripe` anlegen (gleiche Ereignisse wie bei [Stripe und Channex](2-dienste.md#stripe-und-channex-verbinden)), das Secret in `.env.int` als `STRIPE_WEBHOOK_SECRET_CONNECT`, danach `./deploy-int.sh`.
6. **Erste Freigabe für prod**: Solange es noch keine freigegebene Version gibt, verweigert `./deploy.sh` den Start. Ablauf: [4-ausrollen.md](4-ausrollen.md#auf-prod-ausrollen).

## Was nur auf int getestet werden kann und was nicht

- Gut: Buchungsstrecke mit Stripe-Testkarten, E-Mail-Texte (alles landet in einem Postfach), Rollen und Menüs, Migrationen mit Demo-Daten, Worker-Jobs (Warteliste, Abbruch-Mail, Erinnerungen).
- Mit Vorsicht: Channex nur gegen Staging, nie echte Hotels anbinden. KI-Funktionen kosten echtes Geld; Schlüssel mit Ausgabenlimit nur gezielt eintragen.
- Nicht testbar: echte Karten und TWINT, Zustellbarkeit der Mails an Gäste (erst auf prod prüfen).
- Eigene Domains der Hotels laufen nur auf prod (Zertifikate für fremde Domains gibt Caddy nur dort aus); auf int heisst der Betrieb `https://int.pontivo.ch/h/<slug>`.

Weiter: [4-ausrollen.md](4-ausrollen.md).
