# Pontivo – Direktbuchung für Hotels

Buchungsmaschine für kleine Hotels: eigene Website mit Direktbuchung, Zahlung über Stripe Connect (TWINT, Karte, Apple Pay, Google Pay) direkt aufs Konto des Hotels, 1,9 % Plattformgebühr. Abgleich mit Booking.com & Co. über Channex folgt in M3.

Auftrag und Details: [`docs/SPEC.md`](docs/SPEC.md) · Offene Fragen und Annahmen: [`QUESTIONS.md`](QUESTIONS.md) · Regeln für KI-Agenten: [`CLAUDE.md`](CLAUDE.md)

## Stand

| Meilenstein | Stand |
| --- | --- |
| **M1 Kern** | fertig: Schema, Suche, Preise, Kurtaxe nach Gemeinde, Hold (30+2 Min.), Ablauf, Storno, Zustandsautomat, Buchungsseiten DE/EN mit Fake-Zahlung. Alle Abnahmetests grün. |
| **M2 Stripe und Admin** | Code fertig und mit gemocktem Stripe getestet: Onboarding (Connect, Direct Charges), Checkout mit 1,9 % Application Fee, Webhooks, Rückerstattung, Magic-Link-Login, Kalender, Buchungen, Einstellungen, E-Mails. **Aktivieren mit eigenen Stripe-Testschlüsseln** (siehe unten). |
| **M3 Channex** | Code fertig und mit gemockter Channex-API getestet: ARI-Outbox (gebündelt, Rate-Limit 10/min, Backoff, Alarm), Buchungen über Feed + Ack (neu, geändert, storniert, Überbuchung, unbekanntes Mapping), Webhook mit HMAC, Admin-Seite „Channex“ (anlegen oder IDs zuordnen, Vollabgleich). **Aktivieren mit Channex-Staging-Schlüssel.** Monatsabrechnung mit CSV und Druck/PDF. |
| Rechtstexte | AGB und Datenschutzerklärung als Entwurf (DE/EN) unter `/<sprache>/agb` und `/<sprache>/datenschutz`, Betreiberangaben aus `PLATFORM_*`-Variablen. **Vor dem Livegang prüfen lassen.** |
| M4 Modul Gäste | offen |

## Lokal starten

Voraussetzungen: [Node.js 22](https://nodejs.org), [Git](https://git-scm.com), [Docker Desktop](https://www.docker.com/products/docker-desktop/) (für die Datenbank).

```bash
git clone https://github.com/mrto1/pontivo.git
cd hotel
npm install
cp .env.example .env.local           # Windows: copy .env.example .env.local
docker compose up -d db              # PostgreSQL 16 im Hintergrund
npm run db:reset                     # Tabellen + Demo-Hotel "Demo Gasthof" (Glarus)
npm run dev                          # http://localhost:3000
npm run worker                       # optional, zweites Terminal: Holds freigeben, E-Mails ausgeben
```

- Hotel-Website: http://demo-gasthof.localhost:3000 (Hotel wird über die Domain erkannt) oder Vorschau http://localhost:3000/h/demo-gasthof/de
- Admin: http://localhost:3000/admin/login mit `admin@example.ch`. Ohne `POSTMARK_SERVER_TOKEN` erscheint der Login-Link direkt auf der Seite und E-Mails werden im Worker-Terminal ausgegeben.
- Mit `PAYMENT_PROVIDER=fake` wird jede Buchung sofort bestätigt (ohne Zahlung).
- Hotel behält eigene Website: Admin → «Einbinden» (Logo, Farbe, Link zurück, Buchungs-Knopf/Suchleiste als Code-Schnipsel `/widget/<slug>.js`).
- Zimmer, Tarife und Fotos: Admin → «Zimmer» (Namen auch auf Englisch).
- Website: Admin → «Website». Gestaltung (6 Layouts, 6 Schriftpaare), Dokumente (PDF, max. 15 MB) und Seiten aus Bausteinen. Der Editor zeigt rechts eine Vorschau (Computer/Handy, auch Entwürfe) und hat über Textfeldern eine Leiste für fett, kursiv, Link, Listen, Zwischentitel, Hausfarbe und unterstrichen. E-Mail, Telefon und Webadressen werden automatisch klickbar.
- Weitere Bausteine: Angebote & Pakete (verweisen auf einen Tarif; Mindestaufenthalt pro Tarif unter «Zimmer»), Gästestimmen (nur echte, mit Name und Quelle), Häufige Fragen (mit FAQ-Daten für Google), Ausflugstipps (auch Wissensquelle für den späteren KI-Chat, `src/services/knowledge.ts`), Anfrageformular (Admin → Anfragen, Mail ans Hotel), Gutscheine (Admin → Gutscheine: Verkauf ein/aus, Beträge, Einlösen in Teilbeträgen). «Lage & Anreise» zeigt mit Koordinaten eine OpenStreetMap-Karte, die erst nach Klick lädt. Auf dem Handy bleibt «Jetzt buchen» unten sichtbar. Jede Seite enthält strukturierte Daten (schema.org Hotel, FAQPage).
- Sprachen: Admin → Website → Sprachen (DE immer, dazu EN, FR, IT, NL). Buchungsstrecke, Gäste-Mails, Storno-Texte und Widget sind übersetzt. Im Editor bearbeitet man Deutsch und eine Zielsprache nebeneinander; «Fehlende Texte übersetzen» nutzt die Claude API (`ANTHROPIC_API_KEY`, Modell `TRANSLATE_MODEL`, Limit `TRANSLATIONS_PER_MONTH` pro Hotel). Ohne Schlüssel füllt man die Felder von Hand; leere Felder zeigen Englisch, dann Deutsch.
- KI-Chat (kostenpflichtiges Modul, SPEC 14b): Admin → KI-Chat. Der Chat antwortet nur aus den Website-Daten (`hotelKnowledge`), nennt keine Zimmerpreise und keine Verfügbarkeit und erscheint als schwebendes Fenster auf allen Hotelseiten und auf `/b/<token>`. Tarife stehen in `ai_plans` (Standard: Basis CHF 19, 250 Gespräche, Zusatzpaket 100 Gespräche = CHF 5; «mini» CHF 4.90 für 50 Gespräche ist vorbereitet, `active=false`). Das Hotel bestätigt den Preis beim Einschalten (Konditionen werden kopiert), setzt optional ein Monatsbudget für Zusatzpakete; ohne Budget pausiert der Chat bei Limit. Gesprächstexte werden nicht gespeichert (`ai_usage` hat nur Zähler). Abrechnung über die Monatsbelastung (`platform_charges`). Einstellungen: `ANTHROPIC_API_KEY`, `CHAT_MODEL`, `AI_CHAT_HARD_CAP`, `CHAT_COST_*`. Auswertung der eigenen Kosten: `SELECT month, count(*), sum(input_tokens), sum(output_tokens) FROM ai_usage GROUP BY month`; Kosten = Tokens × Preis pro Million (`costUsd` in `src/services/chat.ts`). Neuen Tarif freischalten: `UPDATE ai_plans SET active = true WHERE code = 'mini'`.
- Website gestalten: Admin → «Website» – Startseite und weitere Seiten aus Bausteinen (DE/EN), Menü, Google-Titel/-Beschreibung, Impressum. Fotos landen im Ordner `UPLOAD_DIR` (Standard `./data/uploads`).

## Tests

```bash
docker compose exec db createdb -U postgres hotel_test   # einmalig
# TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/hotel_test setzen
npm test                             # Unit + Integration gegen echte Postgres-DB (102 Tests)
npm run test:e2e                     # Playwright: suchen, buchen, stornieren (Dev-Server muss laufen oder wird gestartet)
```

Abnahmetests (SPEC 12): `tests/unit/pricing.test.ts` (Preis-Testfälle 5.2), `tests/integration/m1-booking.test.ts` (20 parallele Holds, Ablauf, Suchregeln, Mandantentrennung), `tests/integration/m2-stripe.test.ts` (Direct Charge + Gebühr, doppelter Webhook, Storno vor/nach Frist, Session abgelaufen, Kalender → Outbox + Audit), `tests/integration/m2-admin.test.ts` (Login, Rollen, Kurtaxe bestätigen, E-Mails).

## Stripe aktivieren (M2, Testmodus)

1. Stripe-Konto anlegen, **Connect** aktivieren (Plattform-Profil ausfüllen), Testmodus.
2. `.env.local`: `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY=sk_test_...`
3. Webhook für **verbundene Konten** einrichten. Lokal am einfachsten mit der Stripe CLI:
   ```bash
   stripe listen --forward-connect-to localhost:3000/api/webhooks/stripe
   ```
   Das angezeigte `whsec_...` als `STRIPE_WEBHOOK_SECRET_CONNECT` eintragen. Ereignisse: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `account.updated`.
4. Admin → Einstellungen → „Stripe-Konto einrichten“ → Test-Onboarding durchklicken → zurück → „Status neu laden“. Danach kann das Hotel live geschaltet werden.
5. Buchen mit Testkarte `4242 4242 4242 4242`. TWINT muss im Stripe-Dashboard freigeschaltet sein.

## Channex aktivieren (M3, Staging)

1. Konto auf https://staging.channex.io anlegen, API-Schlüssel erzeugen.
2. `.env.local`: `CHANNEX_BASE_URL=https://staging.channex.io/api/v1`, `CHANNEX_API_KEY=...`
3. `npm run worker` starten (sendet alle 6 s die Änderungen, holt Buchungen sofort per Webhook, zur Sicherheit alle 15 Minuten).
4. Admin → Channex → „In Channex anlegen“ (oder vorhandene IDs eintragen) → „Abgleich einschalten“.
5. Webhook in Channex (nötig, sonst kommen Portal-Buchungen erst nach bis zu 15 Minuten): URL `<APP_BASE_URL>/api/webhooks/channex`, Ereignis `booking`, signiert; den Signaturschlüssel als `CHANNEX_WEBHOOK_SECRET` eintragen. Ohne Webhook kommen Buchungen erst nach bis zu 15 Minuten (Überbuchungsgefahr).
6. In Channex Booking.com verbinden und eine Testbuchung auslösen → erscheint unter Buchungen.

Für die Zertifizierung (SPEC 7.4) zeigt man Channex live: Preisänderung und Sperre im Admin-Kalender, Buchung, Änderung und Storno.

## Betrieb

- `Dockerfile` (Next.js standalone) und `docker-compose.yml` (DB, App, Worker). Hosting mit Daten in der Schweiz oder EU.
- Migrationen: `npm run db:migrate` (wendet `db/migrations/*.sql` an).
- Die Domain eines Hotels (`hotels.primary_domain`, z. B. `www.hotel1.ch`) per DNS auf den Server zeigen lassen; die Seite erkennt das Hotel am Host.
