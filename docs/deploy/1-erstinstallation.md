# Erstinstallation von Pontivo auf pontivo.ch (Infomaniak)

Stand: 20.11.2026. Ziel: Pontivo läuft auf **https://pontivo.ch**, auf einem eigenen kleinen Server von Infomaniak in der Schweiz. Einmalig, von oben nach unten. Zurück zur Übersicht: [DEPLOY.md](../DEPLOY.md).

## Warum nicht das Webhosting?

Das Infomaniak-Webhosting kann zwar Node.js, hat aber **keine PostgreSQL-Datenbank** (nur MySQL/MariaDB) und ist nicht für
dauernd laufende Hintergrundprozesse gedacht. Pontivo braucht beides (Datenbank PostgreSQL, Worker für E-Mails, Holds, Channex,
Mindestgebühr). Darum: **VPS Lite** von Infomaniak. Die Domain pontivo.ch bleibt bei Infomaniak, nur die DNS-Einträge zeigen auf den Server.

Empfehlung: **VPS Lite 2 vCPU / 4 GB RAM / 60 GB** (laut Infomaniak CHF 7.20/Monat bei Jahreszahlung, ohne MWST, Stand 11/2026).
Das reicht für die ersten Dutzend Betriebe. Später kann man hochstufen.

## Schritt 1: VPS bestellen (Infomaniak Manager)

1. Manager → «VPS Lite» bestellen, **Ubuntu 24.04**, Grösse 2 vCPU / 4 GB.
2. Beim Bestellen einen **SSH-Schlüssel** hinterlegen. Noch keinen? Auf dem Mac im Terminal: `ssh-keygen -t ed25519`, dann den Inhalt von `~/.ssh/id_ed25519.pub` einfügen.
3. Nach der Einrichtung die **IP-Adresse** des Servers notieren (z. B. `83.166.x.x`).
4. Falls im Manager eine Firewall für den VPS angezeigt wird: Ports **22, 80, 443** (TCP) und **443 (UDP)** öffnen.

## Schritt 2: Domain auf den Server zeigen lassen (DNS bei Infomaniak)

Manager → Domains → pontivo.ch → DNS-Zone:

| Typ | Name | Wert |
|---|---|---|
| A | `@` (pontivo.ch) | IP des VPS |
| A | `www` | IP des VPS |

Bestehende A- oder AAAA-Einträge für `@` und `www`, die noch auf das Webhosting zeigen, **löschen**. Infomaniak weist beim Ändern eines A-Eintrags darauf hin, dass auch der AAAA-Eintrag (IPv6) angepasst werden muss: Hat der VPS eine IPv6-Adresse (steht im Manager beim VPS), je einen AAAA-Eintrag mit dieser Adresse anlegen, sonst alte AAAA-Einträge löschen. Ein AAAA, der noch aufs Webhosting zeigt, führt Besucher mit IPv6 auf den falschen Server. E-Mail-Einträge (MX usw.) nicht anfassen.
Die Änderung braucht einige Minuten bis wenige Stunden. Prüfen: `nslookup pontivo.ch` zeigt die IP des VPS.

Das Webhosting wird danach nicht mehr gebraucht. E-Mail-Adressen wie info@pontivo.ch laufen über Infomaniak Mail und sind davon unabhängig.

## Schritt 3: Server vorbereiten (einmalig)

```bash
ssh ubuntu@IP-DES-VPS          # Benutzername laut Infomaniak (oft ubuntu)
sudo -i
git clone https://github.com/mrto1/pontivo.git /opt/pontivo
bash /opt/pontivo/deploy/setup-server.sh
```

Das installiert Docker, schaltet die Firewall ein (nur SSH, HTTP, HTTPS) und aktiviert automatische Sicherheitsupdates.
Das Repository ist privat? Dann zuerst auf dem Server einen Deploy-Key anlegen (`ssh-keygen -t ed25519`) und den öffentlichen Schlüssel
in GitHub unter Repository → Settings → Deploy keys eintragen (nur Lesen), danach mit `git clone git@github.com:mrto1/pontivo.git /opt/pontivo`.

## Schritt 4: Einstellungen und Geheimnisse

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
- `POSTMARK_SERVER_TOKEN`, `EMAIL_FROM` (siehe [Postmark](2-dienste.md#e-mail-versand-postmark))
- `PLATFORM_OPERATOR` (Standard «Lynxora GmbH»), `PLATFORM_ADDRESS` (Standard «Konradstrasse 1, 8400 Winterthur»), `PLATFORM_UID`, `PLATFORM_CONTACT_EMAIL`: erscheinen in Impressum, AGB und Datenschutz. Auf dem Server alte Werte (Einzelunternehmen) entfernen oder ersetzen

`PAYMENT_PROVIDER=fake` ist in Produktion gesperrt (Buchungen würden ohne Zahlung bestätigt).

## Schritt 5: Starten

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

## Schritt 6: Dich als Plattform-Admin anlegen

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec app node --import tsx scripts/create-admin.ts du@pontivo.ch "Vorname Name"
```

Dann auf https://pontivo.ch/mypontivo/login anmelden (Login-Link per E-Mail, dafür braucht es Postmark).

Weiter mit [2-dienste.md](2-dienste.md): E-Mail, Zahlung, Channex, Bot-Schutz. Danach [3-testumgebung.md](3-testumgebung.md) und [5-betrieb.md](5-betrieb.md) (Sicherung nicht vergessen).
