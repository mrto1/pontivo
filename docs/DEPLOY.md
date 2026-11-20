# Pontivo auf pontivo.ch bringen (Infomaniak)

Stand: 10.11.2026. Ziel: Pontivo läuft auf **https://pontivo.ch**, auf einem eigenen kleinen Server von Infomaniak in der Schweiz.

## Warum nicht das Webhosting?

Das Infomaniak-Webhosting kann zwar Node.js, hat aber **keine PostgreSQL-Datenbank** (nur MySQL/MariaDB) und ist nicht für
dauernd laufende Hintergrundprozesse gedacht. Pontivo braucht beides (Datenbank PostgreSQL, Worker für E-Mails, Holds, Channex,
Mindestgebühr). Darum: **VPS Lite** von Infomaniak. Die Domain pontivo.ch bleibt bei Infomaniak, nur die DNS-Einträge zeigen auf den Server.

Empfehlung: **VPS Lite 2 vCPU / 4 GB RAM / 60 GB** (laut Infomaniak CHF 7.20/Monat bei Jahreszahlung, ohne MWST, Stand 11/2026).
Das reicht für die ersten Dutzend Betriebe. Später kann man hochstufen.

## 1. VPS bestellen (Infomaniak Manager)

1. Manager → «VPS Lite» bestellen, **Ubuntu 24.04**, Grösse 2 vCPU / 4 GB.
2. Beim Bestellen einen **SSH-Schlüssel** hinterlegen. Noch keinen? Auf dem Mac im Terminal: `ssh-keygen -t ed25519`, dann den Inhalt von `~/.ssh/id_ed25519.pub` einfügen.
3. Nach der Einrichtung die **IP-Adresse** des Servers notieren (z. B. `83.166.x.x`).
4. Falls im Manager eine Firewall für den VPS angezeigt wird: Ports **22, 80, 443** (TCP) und **443 (UDP)** öffnen.

## 2. Domain auf den Server zeigen lassen (DNS bei Infomaniak)

Manager → Domains → pontivo.ch → DNS-Zone:

| Typ | Name | Wert |
|---|---|---|
| A | `@` (pontivo.ch) | IP des VPS |
| A | `www` | IP des VPS |

Bestehende A- oder AAAA-Einträge für `@` und `www`, die noch auf das Webhosting zeigen, **löschen**. E-Mail-Einträge (MX usw.) nicht anfassen.
Die Änderung braucht einige Minuten bis wenige Stunden. Prüfen: `nslookup pontivo.ch` zeigt die IP des VPS.

Das Webhosting wird danach nicht mehr gebraucht. E-Mail-Adressen wie info@pontivo.ch laufen über Infomaniak Mail und sind davon unabhängig.

## 3. Server vorbereiten (einmalig)

```bash
ssh ubuntu@IP-DES-VPS          # Benutzername laut Infomaniak (oft ubuntu)
sudo -i
git clone https://github.com/mrto1/pontivo.git /opt/pontivo
bash /opt/pontivo/deploy/setup-server.sh
```

Das installiert Docker, schaltet die Firewall ein (nur SSH, HTTP, HTTPS) und aktiviert automatische Sicherheitsupdates.
Das Repository ist privat? Dann zuerst auf dem Server einen Deploy-Key anlegen (`ssh-keygen -t ed25519`) und den öffentlichen Schlüssel
in GitHub unter Repository → Settings → Deploy keys eintragen (nur Lesen), danach mit `git clone git@github.com:mrto1/pontivo.git /opt/pontivo`.

## 4. Einstellungen und Geheimnisse

```bash
cd /opt/pontivo/deploy
cp .env.production.example .env.production
nano .env.production
```

Ausfüllen (zufällige Werte mit `openssl rand -hex 32`):

- `ACME_EMAIL`: deine E-Mail (für Zertifikats-Warnungen von Let's Encrypt)
- `POSTGRES_PASSWORD`, `AUTH_SECRET`: je ein neuer Zufallswert
- `GUEST_DATA_KEY`: `openssl rand -base64 32` – **sicher aufbewahren** (z. B. Passwortmanager). Ohne ihn sind gespeicherte Ausweisnummern und Geburtsdaten nicht mehr lesbar.
- `STRIPE_SECRET_KEY`: zuerst den **Test**-Schlüssel `sk_test_…`, live erst mit dem ersten Hotel
- `POSTMARK_SERVER_TOKEN`, `EMAIL_FROM` (siehe Schritt 7)
- `PLATFORM_OPERATOR` (Standard «Lynxora GmbH»), `PLATFORM_ADDRESS` (Standard «Konradstrasse 1, 8400 Winterthur»), `PLATFORM_UID`, `PLATFORM_CONTACT_EMAIL`: erscheinen in Impressum, AGB und Datenschutz. Auf dem Server alte Werte (Einzelunternehmen) entfernen oder ersetzen

`PAYMENT_PROVIDER=fake` ist in Produktion gesperrt (Buchungen würden ohne Zahlung bestätigt).

## 5. Starten

```bash
cd /opt/pontivo/deploy
./deploy.sh
```

Das baut Pontivo, führt die Datenbank-Migrationen aus und startet: Datenbank, App, Worker, Caddy (HTTPS) und die tägliche Sicherung.
Nach 1–2 Minuten ist **https://pontivo.ch** erreichbar. Das Zertifikat holt Caddy automatisch.

Status und Logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app worker caddy
```

## 6. Dich als Plattform-Admin anlegen

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec app node --import tsx scripts/create-admin.ts du@pontivo.ch "Vorname Name"
```

Dann auf https://pontivo.ch/mypontivo/login anmelden (Login-Link per E-Mail, dafür braucht es Postmark).

## 6b. Bot-Schutz (Cloudflare Turnstile)
1. Kostenloses Konto auf https://dash.cloudflare.com anlegen (die Domain muss nicht bei Cloudflare liegen), links «Turnstile», «Add widget».
2. Hostname **pontivo.ch** eintragen (Unterdomains sind mit abgedeckt), Modus «Managed». Kostenlose Pläne erlauben höchstens 10 Hostnamen je Widget und keine Platzhalter.
3. **Site Key** und **Secret Key** in `deploy/.env.production` als `TURNSTILE_SITE_KEY` und `TURNSTILE_SECRET_KEY` eintragen, dann `sudo ./deploy.sh`. Den Secret Key nie weitergeben.
4. Test: Registrierung und Login funktionieren; ohne die Schlüssel ist die Prüfung aus.

## 7. E-Mail-Versand (Postmark)

1. Konto bei postmarkapp.com, Server «Pontivo» anlegen, **Server API Token** → `POSTMARK_SERVER_TOKEN`.
2. Unter «Sender Signatures» die Domain **pontivo.ch** hinzufügen. Postmark zeigt zwei DNS-Einträge (DKIM als TXT, Return-Path als CNAME).
   Beide in der DNS-Zone bei Infomaniak eintragen, dann in Postmark «Verify».
3. `EMAIL_FROM=buchung@pontivo.ch` setzen, `./deploy.sh` erneut ausführen.

## 8. Stripe und Channex verbinden

- **Stripe** (Dashboard → Developers → Webhooks): Endpoint für **Connected accounts** anlegen,
  URL `https://pontivo.ch/api/webhooks/stripe`, Ereignisse: `checkout.session.completed`, `checkout.session.expired`,
  `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `account.updated`, `charge.refunded`, `charge.dispute.created`.
  Signing secret → `STRIPE_WEBHOOK_SECRET_CONNECT`. Zusätzlich in Stripe Connect die Plattform-Einstellungen (Name, Logo, Branding) ausfüllen.
- **Channex**: Den Staging-API-Key vorher **neu erzeugen** (er stand im Chat) und als `CHANNEX_API_KEY` eintragen, `./deploy.sh`. Dann den Webhook mit einem Befehl einrichten:
  ```bash
  docker compose --env-file .env.production -f docker-compose.prod.yml exec app node --import tsx scripts/channex-webhook.ts --new-key
  ```
  Das legt einen Signierschlüssel und einen signierten Webhook auf `https://pontivo.ch/api/webhooks/channex` an. Die ausgegebene Zeile
  `CHANNEX_WEBHOOK_SECRET=…` in `.env.production` eintragen und nochmals `./deploy.sh`. Ohne Webhook kommen Portal-Buchungen erst nach bis zu 15 Minuten.

Nach jeder Änderung an `.env.production`: `./deploy.sh`.

## 9. Eigene Domains der Hotels

Ein Hotel mit eigener Domain (z. B. www.gasthof-beispiel.ch) trägt bei seinem Anbieter einen **A-Eintrag** auf die IP des VPS ein
(oder CNAME auf pontivo.ch). Im Admin bei «Einbinden» bzw. in der Plattform-Verwaltung die Domain eintragen.
Caddy holt das Zertifikat beim ersten Aufruf automatisch – aber nur für Domains, die einem Hotel gehören (`/api/tls-check`).

## 10. Sicherung ausser Haus (wichtig)

VPS Lite hat **keine Snapshots**. Der Container `backup` legt täglich Datenbank und Fotos im Volume `pontivo_backups` ab (14 Tage).
Das schützt vor Fehlbedienung, nicht vor dem Verlust des Servers. Darum zusätzlich täglich eine Kopie ausser Haus, z. B. mit
**Infomaniak Swiss Backup** (S3-kompatibel) oder kDrive über `rclone`. Kann ich bei Bedarf einrichten.

Wiederherstellen (Beispiel):

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db pg_restore -U pontivo -d pontivo --clean < db-2026-11-10.dump
```

## Neue Version ausrollen (Kurzfassung, Details im Abschnitt «Testumgebung und Ausrollen»)

```bash
cd /opt/pontivo && git pull          # Skripte aktualisieren
cd deploy && ./deploy-int.sh         # 1. auf int ausrollen und dort testen
./release.sh                         # 2. getestete Version freigeben
./deploy.sh                          # 3. Produktion ausrollen
```

## Checkliste vor dem ersten echten Hotel

- [ ] AGB, Datenschutz, Bedingungen für Gastgeber juristisch geprüft (QUESTIONS.md)
- [ ] `PLATFORM_*`-Angaben ausgefüllt, Impressum vorhanden
- [ ] Stripe auf Live-Schlüssel umgestellt, Webhook live angelegt
- [ ] Postmark-Domain bestätigt, Test-Login-Mail angekommen
- [ ] Sicherung ausser Haus läuft
- [ ] Testbuchung mit echter Karte und Rückerstattung

## Postmark: Bounces und Spam-Beschwerden

1. Geheimnis erzeugen: `openssl rand -hex 24` und in `.env.production` als `POSTMARK_WEBHOOK_SECRET=…` eintragen, dann `./deploy.sh` (führt auch die Migration aus).
2. In Postmark beim Stream «Default Transactional Stream» → Webhooks → Webhook hinzufügen: URL `https://pontivo.ch/api/webhooks/postmark`, Basic Auth mit beliebigem Benutzernamen (z. B. `postmark`) und dem Geheimnis als Passwort. Ereignisse **Bounce** und **Spam Complaint** anwählen, mit «Test» prüfen.
3. Adressen mit hartem Bounce oder Spam-Beschwerde landen in `email_suppressions`; Mails an sie werden nicht mehr gesendet (Status `cancelled`).


## Push-Mitteilungen im Admin

1. Schlüsselpaar erzeugen (einmalig, auf dem eigenen Rechner oder dem Server): `npx web-push generate-vapid-keys`
2. In `.env.production` eintragen: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (geheim, nie in Chat oder Git) und `VAPID_SUBJECT=mailto:info@pontivo.ch`.
3. `./deploy.sh` (Migration 0018, der Worker sendet jede Minute).
4. Jedes Mitglied schaltet sein Gerät im Admin unter «Mehr» → «Mitteilungen einschalten» ein. Auf dem iPhone zuerst die App zum Home-Bildschirm hinzufügen und von dort öffnen.

Den Schlüssel nach dem Setzen nicht mehr ändern: sonst müssen alle Geräte die Mitteilungen neu einschalten.

## KI-Chat (kostenpflichtiges Modul)

1. In `.env.production` muss `ANTHROPIC_API_KEY` stehen (derselbe Schlüssel wie für die Übersetzung). Optional: `CHAT_MODEL` (Standard `claude-haiku-5-5`), `AI_CHAT_HARD_CAP` (Gespräche pro Hotel und Monat, Standard 5000), `CHAT_COST_IN_USD_PER_MTOK` und `CHAT_COST_OUT_USD_PER_MTOK` (für die Kostenauswertung; Preise vor Gebrauch bei Anthropic prüfen).
2. `./deploy.sh` bringt Migration 0020 (Tarife, Nutzungszähler, Abrechnungsspalten) live.
3. Im Anthropic-Konto ein Ausgabenlimit setzen (Console → Limits), damit auch bei Fehlern keine Überraschung entsteht.
4. Pilotpreise oder Rabatte: `UPDATE hotel_modules SET settings = jsonb_set(settings, '{terms,priceRappen}', '900') WHERE module = 'ai_chat' AND hotel_id = '<id>';`
5. Kosten prüfen: `SELECT month, count(*) AS gespraeche, sum(input_tokens) AS tok_in, sum(output_tokens) AS tok_out FROM ai_usage GROUP BY month ORDER BY month DESC;`

## Sicherung auf den eigenen PC (kostenlos)

Der Container `backup` sichert täglich die Datenbank und die Uploads nach `/opt/pontivo/backups` (14 Tage Aufbewahrung, nur für den Benutzer `ubuntu` lesbar). Eine Sicherung auf demselben Server schützt nicht vor einem Totalausfall des Servers, deshalb holst du die Dateien regelmässig auf deinen PC:

1. Einmalig auf dem Server: `cd /opt/pontivo && git pull && cd deploy && ./deploy.sh` (der Sicherungsordner wird dabei von einem Docker-Volume auf `/opt/pontivo/backups` umgestellt; die ersten Dateien entstehen gleich nach dem Start).
2. Auf dem PC (PowerShell, im Ordner des Repos): `powershell -ExecutionPolicy Bypass -File scripts\pull-backups.ps1`. Zielordner standardmässig `%USERPROFILE%\PontivoBackups`, lokal werden 90 Tage behalten.
3. Automatisch: Windows-Aufgabenplanung → neue Aufgabe → täglich → Programm `powershell`, Argumente `-ExecutionPolicy Bypass -File "C:\Pfad\zum\Repo\scripts\pull-backups.ps1"`. Der PC muss zur Zeit eingeschaltet sein, sonst wird einfach am nächsten Tag nachgeholt.
4. Die Dateien enthalten Personendaten (DSG): Zielordner auf einer verschlüsselten Platte (BitLocker) ablegen, nicht in eine Cloud synchronisieren.
5. Wiederherstellung testen (mindestens einmal): `pg_restore -d <leere Datenbank> db-JJJJ-MM-TT.dump`.

## Überwachung

- Der Worker meldet sich jede Minute. `GET https://pontivo.ch/api/health?deep=1` antwortet mit 200, wenn alles in Ordnung ist, und mit 503 plus den Namen der Probleme (`worker`, `email_backlog`, `channex_backlog`, `stuck_holds`, `disk`). Dort einen kostenlosen Uptime-Dienst einrichten (z. B. UptimeRobot, Prüfintervall 5 Minuten, Benachrichtigung per Mail). Für die einfache Prüfung der Website reicht `/api/health`.
- Der Worker prüft alle 10 Minuten selbst und schickt bei neuen Problemen eine Mail an `PLATFORM_ALERT_EMAIL` (pro Problem höchstens alle 6 Stunden).
- Nachts um 04:10 gleicht ein Job Stripe-Zahlungen mit Buchungen ab (bezahlt ohne bestätigte Buchung, bestätigt ohne Zahlung, bezahlt aber abgelaufen) und meldet Abweichungen per Mail. Er ändert nichts selbst.


## Buchhaltung (Banana)

Am 5. jedes Monats legt der Worker die Erträge des Vormonats als `pontivo-JJJJ-MM.txt` in `/opt/pontivo/buchhaltung` ab. `scripts\pull-backups.ps1` kopiert sie nach `%USERPROFILE%\PontivoBuchhaltung` (werden nicht gelöscht, Aufbewahrungspflicht 10 Jahre).

Einmal einrichten:
1. Auf dem Server: `mkdir -p /opt/pontivo/buchhaltung`, in `deploy/.env.production` die Kontonummern `BANANA_ACCOUNT_STRIPE`, `BANANA_ACCOUNT_REV_FEES`, `BANANA_ACCOUNT_REV_MINIMUM`, `BANANA_ACCOUNT_REV_AI` an den eigenen Kontenplan anpassen, dann `./deploy.sh`.
2. In Banana: Aktionen › In Buchhaltung importieren › «Buchungen» › Dateityp «Textdatei mit Kopfzeile» › UTF-8 anhaken › Datei wählen. Zuerst mit einem Monat und einer Kopie der Buchhaltung ausprobieren, besonders die Beträge (Dezimalpunkt) und die Kontonummern prüfen.
3. Manuell, auch für frühere Monate: `docker compose --env-file .env.production -f docker-compose.prod.yml run --rm worker npm run export:banana -- 2026-11`

Nicht in der Datei: Stripe-Gebühren, Server- und Anthropic-Kosten (Aufwand, Belege selbst ablegen) und die Bankseite (kommt aus dem Kontoauszug der Bank).

## Betriebe und Benutzer verwalten, Testkonten löschen
Bequem im Admin: `https://pontivo.ch/admin/plattform` (nur Plattform-Admin; Link unten auf der Übersicht). Dort: Betriebe pausieren oder wieder online nehmen, Mitglieder hinzufügen oder entfernen, Login-Link senden, Sicherheit (Passkeys, Authenticator) eines Benutzers zurücksetzen, Betriebe und Benutzer endgültig löschen (Bestätigung durch Eintippen von Name bzw. E-Mail). Jede Löschung und jedes Zurücksetzen steht im Protokoll (`audit_log`).

Alternativ per Kommandozeile (Testkonto samt Betrieb):
Löscht ein Konto und seine Betriebe vollständig, mit allen Buchungen, Gästen und Mails (nicht rückgängig). Ohne `--yes` zeigt das Skript nur, was gelöscht würde. Betriebe mit weiteren Mitgliedern oder Status «live» bleiben (live nur mit `--include-live`), Plattform-Admins werden nie gelöscht.
```bash
cd /opt/pontivo/deploy
sudo docker compose --env-file .env.production -f docker-compose.prod.yml exec app node --import tsx scripts/delete-test-account.ts test@example.ch
sudo docker compose --env-file .env.production -f docker-compose.prod.yml exec app node --import tsx scripts/delete-test-account.ts test@example.ch --yes
```
Hinweis: Stripe-Konto und Channex-Property des Testbetriebs werden dabei nicht mitgelöscht, sie gehören bei Stripe/Channex separat entfernt.


# Testumgebung und Ausrollen

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

1. **DNS** (Infomaniak, Zone pontivo.ch): A-Eintrag `int` → IP des VPS.
2. **Code holen** (auf dem Server, als root bzw. mit `sudo -i`):
   ```bash
   git clone https://github.com/mrto1/pontivo.git /opt/pontivo-int
   cd /opt/pontivo-int/deploy
   cp .env.int.example .env.int
   nano .env.int
   ```
   Zufallswerte mit `openssl rand -hex 32` (`POSTGRES_PASSWORD`, `AUTH_SECRET`) und `openssl rand -base64 32` (`GUEST_DATA_KEY`). **Nie** die Werte aus `.env.production` kopieren. Stripe nur mit Testschlüsseln, `MAIL_REDIRECT_TO` auf eine eigene Adresse (z. B. test@pontivo.ch), Postmark-Token darf derselbe sein.
3. **Passwortschutz** (im Ordner der Produktion, weil dort Caddy läuft):
   ```bash
   cd /opt/pontivo && git pull && cd deploy
   ./int-password.sh martin
   ```
   Mit diesem Benutzer und Passwort öffnet man int im Browser. Webhooks (Stripe, Postmark, Channex) sind davon ausgenommen.
4. **Erstmals ausrollen**: `cd /opt/pontivo-int/deploy && ./deploy-int.sh`. Danach einmalig den Demo-Betrieb anlegen:
   `docker compose --env-file .env.int -f docker-compose.int.yml exec app node --import tsx scripts/seed.ts`
   und sich als Plattform-Admin anlegen wie in Schritt 6 oben, aber mit `--env-file .env.int -f docker-compose.int.yml`.
5. **Stripe-Testmodus**: im Stripe-Dashboard (Testmodus) einen Webhook für Connected accounts auf `https://int.pontivo.ch/api/webhooks/stripe` anlegen (gleiche Ereignisse wie in Schritt 8), das Secret in `.env.int` als `STRIPE_WEBHOOK_SECRET_CONNECT`, danach `./deploy-int.sh`.
6. **Erste Freigabe für prod**: Solange es noch keine freigegebene Version gibt, verweigert `./deploy.sh` den Start. Ablauf siehe unten («Prod ausrollen»).

## Auf int ausrollen (so oft man will)

```bash
ssh ubuntu@IP-DES-VPS
cd /opt/pontivo-int/deploy
sudo ./deploy-int.sh                 # neuester Stand von main
sudo ./deploy-int.sh mein-branch     # oder ein bestimmter Branch/Commit
```
Das holt den Code, baut, führt die Datenbank-Migrationen aus und startet neu (1–3 Minuten). Danach auf https://int.pontivo.ch testen.

Int zurücksetzen (alles leer, frisch mit Demo-Betrieb):
```bash
cd /opt/pontivo-int/deploy
sudo docker compose --env-file .env.int -f docker-compose.int.yml down -v
sudo ./deploy-int.sh
sudo docker compose --env-file .env.int -f docker-compose.int.yml exec app node --import tsx scripts/seed.ts
```
(`-v` löscht die Testdatenbank, das ist nur auf int erlaubt.)

## Auf prod ausrollen

```bash
ssh ubuntu@IP-DES-VPS
cd /opt/pontivo && sudo git pull       # damit die Skripte aktuell sind
cd deploy
sudo ./release.sh                      # gibt die Version frei, die jetzt auf int läuft (Tag prod-JJJJMMTT-HHMM)
sudo ./deploy.sh                       # rollt die neueste freigegebene Version aus
```
`deploy.sh` sichert vorher die Datenbank, baut, führt die Migrationen aus und startet neu. Danach kurz prüfen: https://pontivo.ch/api/health?deep=1 (Antwort 200), eine Testseite öffnen, im Admin anmelden.

**Wichtig:** `release.sh` gibt exakt die Version frei, die auf int läuft. Also vor dem Freigeben prüfen, dass int den gewünschten Stand zeigt (`cd /opt/pontivo-int && git log -1`).

## Zurück zur vorherigen Version (Notfall)

```bash
cd /opt/pontivo/deploy
git tag -l 'prod-*' --sort=-creatordate   # Liste der Freigaben, die neueste oben
sudo ./deploy.sh prod-20261118-1030        # eine ältere Freigabe ausrollen
```
Datenbank-Migrationen werden nie automatisch zurückgenommen. Neue Migrationen fügen nur Tabellen/Spalten hinzu, eine ältere Version läuft in der Regel damit weiter. Bei Datenproblemen die Sicherung vor dem Ausrollen einspielen (Abschnitt 10, Dateien in `/opt/pontivo/backups`).

## Was nur auf int getestet werden kann und was nicht

- Gut: Buchungsstrecke mit Stripe-Testkarten, E-Mail-Texte (alles landet in einem Postfach), Rollen und Menüs, Migrationen mit Demo-Daten, Worker-Jobs (Warteliste, Abbruch-Mail, Erinnerungen).
- Mit Vorsicht: Channex nur gegen Staging, nie echte Hotels anbinden. KI-Funktionen kosten echtes Geld; Schlüssel mit Ausgabenlimit nur gezielt eintragen.
- Nicht testbar: echte Karten und TWINT, Zustellbarkeit der Mails an Gäste (erst auf prod prüfen).
- Eigene Domains der Hotels laufen nur auf prod (Zertifikate für fremde Domains gibt Caddy nur dort aus); auf int heisst der Betrieb `https://int.pontivo.ch/h/<slug>`.
