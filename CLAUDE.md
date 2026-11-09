# Regeln für KI-Agenten in diesem Repository

Vor jeder Arbeit lesen: `docs/SPEC.md` (Auftrag, Quelle der Wahrheit) und `db/schema.sql` bzw. `db/migrations/`.

- Baue nur, was in `docs/SPEC.md` steht. Fehlt etwas: Frage in `QUESTIONS.md` eintragen, einfachste sichere Annahme treffen und im Code mit `// ASSUMPTION:` markieren.
- Keine externen API-Felder erfinden (Stripe, Channex): verlinkte Doku in SPEC 13 lesen.
- Geld immer als Integer in Rappen. Kalendertage als `'YYYY-MM-DD'`-Strings (`src/domain/dates.ts`), Zeitpunkte als `timestamptz`.
- Jede Abfrage filtert nach `hotel_id` (Mandantentrennung). Admin-Seiten und Server Actions immer über `requireHotel()` (`src/auth/guard.ts`).
- Keine Kartendaten speichern; Zahlungen nur über Stripe Checkout.
- Geheimnisse nur aus Umgebungsvariablen (`src/env.ts`, `.env.example`).
- Schemaänderung = neue Datei in `db/migrations/` UND `src/db/schema.ts` nachführen.
- Jede Änderung an `inventory_days`/`rates_days` schreibt in derselben Transaktion einen `channex_outbox`-Eintrag (`src/services/outbox.ts`) und einen `audit_log`-Eintrag.
- **Kein Code für einzelne Hotels.** Alle Hotels laufen auf demselben Code. Unterschiede sind Daten: Inhalte, Bausteine, Layout, Schrift, Farbe, Logo (`hotels.content`, `site_pages`). Nie `if (hotel.slug === "…")`, feste Hotel-IDs/Domains oder CSS nur für ein Hotel. Sonderwunsch eines Hotels → (1) mit bestehenden Bausteinen/Einstellungen lösen, (2) wenn er vielen Hotels nützt: neuen Baustein oder neue Einstellung für alle bauen, (3) sonst ablehnen (individuelle Website über Partner, Pontivo liefert nur die Buchung). Geprüft durch `tests/unit/no-hotel-specific-code.test.ts`.
- Ein Meilenstein ist fertig, wenn alle Abnahmekriterien (SPEC 12) als Tests grün sind: `npm test` und `npm run test:e2e`.

## Aufbau

```
app/                    Next.js App Router (öffentliche Seiten, /b/<token>, /admin, /api)
components/public/      Hotel-Website und Buchungsstrecke
src/domain/             reine Logik ohne I/O (Preise, Kurtaxe, Verfügbarkeit, Storno, Zustandsautomat)
src/services/           DB-Logik (Suche, Buchungen/Hold, Kalender, Einstellungen)
src/integrations/stripe Stripe Connect (Checkout, Webhooks, Refund, Onboarding)
src/integrations/channex  Channex: Client, Outbox-Worker, Feed/Ack, Webhook-Signatur, Verbinden
src/legal/               AGB und Datenschutz (Entwurf)
src/email/              Outbox, Templates, Versand (Postmark)
src/jobs/worker.ts      pg-boss Worker (Holds, E-Mails, Horizont)
db/migrations/          SQL-Migrationen (scripts/migrate.ts)
tests/                  unit, integration (echte Postgres-DB), e2e (Playwright)
```
