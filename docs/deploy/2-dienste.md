# Dienste anbinden

E-Mail, Zahlung, Channex, Bot-Schutz, eigene Domains, Push, KI und Buchhaltung. Jeder Abschnitt steht für sich und kann einzeln gemacht werden. **Nach jeder Änderung an `.env.production`: `./deploy.sh`.** Zurück zur Übersicht: [DEPLOY.md](../DEPLOY.md).

## E-Mail-Versand (Postmark)

1. Konto bei postmarkapp.com, Server «Pontivo» anlegen, **Server API Token** → `POSTMARK_SERVER_TOKEN`.
2. Unter «Sender Signatures» die Domain **pontivo.ch** hinzufügen. Postmark zeigt zwei DNS-Einträge (DKIM als TXT, Return-Path als CNAME).
   Beide in der DNS-Zone bei Infomaniak eintragen, dann in Postmark «Verify».
3. `EMAIL_FROM=buchung@pontivo.ch` setzen, `./deploy.sh` erneut ausführen.

### Bounces und Spam-Beschwerden

1. Geheimnis erzeugen: `openssl rand -hex 24` und in `.env.production` als `POSTMARK_WEBHOOK_SECRET=…` eintragen, dann `./deploy.sh` (führt auch die Migration aus).
2. In Postmark beim Stream «Default Transactional Stream» → Webhooks → Webhook hinzufügen: URL `https://pontivo.ch/api/webhooks/postmark`, Basic Auth mit beliebigem Benutzernamen (z. B. `postmark`) und dem Geheimnis als Passwort. Ereignisse **Bounce** und **Spam Complaint** anwählen, mit «Test» prüfen.
3. Adressen mit hartem Bounce oder Spam-Beschwerde landen in `email_suppressions`; Mails an sie werden nicht mehr gesendet (Status `cancelled`).

## Stripe und Channex verbinden

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

## Bot-Schutz (Cloudflare Turnstile)
1. Kostenloses Konto auf https://dash.cloudflare.com anlegen (die Domain muss nicht bei Cloudflare liegen), links «Turnstile», «Add widget».
2. Hostname **pontivo.ch** eintragen (Unterdomains sind mit abgedeckt), Modus «Managed». Kostenlose Pläne erlauben höchstens 10 Hostnamen je Widget und keine Platzhalter.
3. **Site Key** und **Secret Key** in `deploy/.env.production` als `TURNSTILE_SITE_KEY` und `TURNSTILE_SECRET_KEY` eintragen, dann `sudo ./deploy.sh`. Den Secret Key nie weitergeben.
4. Test: Registrierung und Login funktionieren; ohne die Schlüssel ist die Prüfung aus.

## Eigene Domains der Hotels

Ein Hotel mit eigener Domain (z. B. www.gasthof-beispiel.ch) trägt bei seinem Anbieter einen **A-Eintrag** auf die IP des VPS ein
(oder CNAME auf pontivo.ch). Im Admin bei «Einbinden» bzw. in der Plattform-Verwaltung die Domain eintragen.
Caddy holt das Zertifikat beim ersten Aufruf automatisch – aber nur für Domains, die einem Hotel gehören (`/api/tls-check`).

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

### KI-Einrichtung aus Website oder PDF und Übersetzung
Dieselbe `ANTHROPIC_API_KEY` genügt. Die KI-Einrichtung (Seite «Einrichten mit KI», nur nach Abo mit Karte) ist durch drei Werte begrenzt: `SETUP_MODEL` (Standard `claude-haiku-5-5`), `SETUP_RUNS_PER_MONTH` (Läufe je Betrieb und Monat, Standard 3) und `SETUP_RUNS_PER_DAY_TOTAL` (alle Betriebe zusammen je 24 Stunden, Standard 100). Ohne Schlüssel ist die Funktion ausgeblendet. Verbrauch: Tabelle `setup_imports` (Spalten `input_tokens`, `output_tokens`):
`SELECT date_trunc('month', created_at) AS monat, count(*) AS laeufe, sum(input_tokens) AS tok_in, sum(output_tokens) AS tok_out FROM setup_imports GROUP BY 1 ORDER BY 1 DESC;`

## Buchhaltung (Banana)

Am 5. jedes Monats legt der Worker die Erträge des Vormonats als `pontivo-JJJJ-MM.txt` in `/opt/pontivo/buchhaltung` ab. `scripts\pull-backups.ps1` kopiert sie nach `%USERPROFILE%\PontivoBuchhaltung` (werden nicht gelöscht, Aufbewahrungspflicht 10 Jahre).

Einmal einrichten:
1. Auf dem Server: `mkdir -p /opt/pontivo/buchhaltung`, in `deploy/.env.production` die Kontonummern `BANANA_ACCOUNT_STRIPE`, `BANANA_ACCOUNT_REV_FEES`, `BANANA_ACCOUNT_REV_MINIMUM`, `BANANA_ACCOUNT_REV_AI` an den eigenen Kontenplan anpassen, dann `./deploy.sh`.
2. In Banana: Aktionen › In Buchhaltung importieren › «Buchungen» › Dateityp «Textdatei mit Kopfzeile» › UTF-8 anhaken › Datei wählen. Zuerst mit einem Monat und einer Kopie der Buchhaltung ausprobieren, besonders die Beträge (Dezimalpunkt) und die Kontonummern prüfen.
3. Manuell, auch für frühere Monate: `docker compose --env-file .env.production -f docker-compose.prod.yml run --rm worker npm run export:banana -- 2026-11`

Nicht in der Datei: Stripe-Gebühren, Server- und Anthropic-Kosten (Aufwand, Belege selbst ablegen) und die Bankseite (kommt aus dem Kontoauszug der Bank).

Weiter: [3-testumgebung.md](3-testumgebung.md).
