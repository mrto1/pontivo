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
git clone https://github.com/mrto1/hotel.git /opt/pontivo
bash /opt/pontivo/deploy/setup-server.sh
```

Das installiert Docker, schaltet die Firewall ein (nur SSH, HTTP, HTTPS) und aktiviert automatische Sicherheitsupdates.
Das Repository ist privat? Dann zuerst auf dem Server einen Deploy-Key anlegen (`ssh-keygen -t ed25519`) und den öffentlichen Schlüssel
in GitHub unter Repository → Settings → Deploy keys eintragen (nur Lesen), danach mit `git clone git@github.com:mrto1/hotel.git /opt/pontivo`.

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
- `PLATFORM_OPERATOR`, `PLATFORM_ADDRESS`, `PLATFORM_CONTACT_EMAIL`: erscheinen in AGB und Datenschutz

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

Dann auf https://pontivo.ch/admin/login anmelden (Login-Link per E-Mail, dafür braucht es Postmark).

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

## Neue Version ausrollen

```bash
cd /opt/pontivo/deploy && ./deploy.sh
```

## Checkliste vor dem ersten echten Hotel

- [ ] AGB, Datenschutz, Bedingungen für Gastgeber juristisch geprüft (QUESTIONS.md)
- [ ] `PLATFORM_*`-Angaben ausgefüllt, Impressum vorhanden
- [ ] Stripe auf Live-Schlüssel umgestellt, Webhook live angelegt
- [ ] Postmark-Domain bestätigt, Test-Login-Mail angekommen
- [ ] Sicherung ausser Haus läuft
- [ ] Testbuchung mit echter Karte und Rückerstattung
