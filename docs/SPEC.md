# SPEC – Buchungsplattform für Hotels (v1)

Stand: 6.11.2026 · Sprache der Spezifikation: Deutsch · Code, Tabellen, Variablen: Englisch

Diese Datei ist der Auftrag für KI-Coding-Agenten. Sie ist zusammen mit `schema.sql` die einzige Quelle der Wahrheit.

---

## 0. Arbeitsregeln für Agenten

1. **Lies zuerst diese Datei ganz, dann `schema.sql`.** Baue nur, was hier steht. Fehlt etwas, schreibe die Frage in `QUESTIONS.md` und triff die einfachste sichere Annahme; markiere sie im Code mit `// ASSUMPTION:`.
2. **Erfinde keine externen API-Felder.** Für Stripe und Channex gelten die verlinkten Dokumentationen (Abschnitt 13). Bei Unklarheit: Doku lesen, nicht raten.
3. **Arbeite in den Meilensteinen aus Abschnitt 12**, einer nach dem anderen. Ein Meilenstein ist fertig, wenn alle Abnahmekriterien als automatische Tests grün sind.
4. **Geld immer als Integer in Rappen**, nie Float. Kalendertage als `DATE`, Zeitpunkte als `timestamptz` (UTC); Anzeige und Fristen in der Zeitzone des Hotels.
5. **Jede Datenbankabfrage filtert nach `hotel_id`** (Mandantentrennung). Kein Endpoint gibt Daten eines anderen Hotels heraus.
6. **Keine Kartendaten speichern.** Zahlungen laufen ausschliesslich über Stripe Checkout.
7. **Geheimnisse nur aus Umgebungsvariablen** (Abschnitt 11), nie im Code oder Repository.
8. Kleine, getestete Commits. Keine neuen Abhängigkeiten ohne Grund.

---

## 1. Ziel und Umfang

Hotels bekommen eine Website mit Direktbuchung. Der Gast bucht, zahlt mit TWINT, Karte, Apple Pay oder Google Pay; das Geld geht direkt an das Hotel (Stripe Connect, Direct Charge), die Plattform behält 1,9 % als Application Fee. Verfügbarkeit und Preise werden über Channex mit Booking.com und anderen Portalen abgeglichen; deren Buchungen kommen in unser System.

**In v1 enthalten**
- Mehrere Hotels (Mandanten) in einem System; Hotel wird über die Domain erkannt.
- Zimmertypen, Ratepläne, Preis und Regeln pro Nacht, Verfügbarkeit pro Nacht.
- Suche, Preisberechnung inkl. Kurtaxe, Hold (30 Minuten), Zahlung, Bestätigung, Ablauf, Stornierung mit Rückerstattung.
- Stripe Connect: Onboarding der Hotels, Direct Charges, Webhooks, Refunds.
- Channex: ARI senden (Outbox), Buchungen empfangen (Webhook + Feed + Ack).
- Admin für Hotels: Kalender, Buchungen, Einstellungen.
- E-Mails an Gast und Hotel.
- DE und EN.

**Nicht in v1** (nicht bauen): eigene Hotelverwaltung ausser Modul „Gäste“ (Phase 2), Google-Hotel-Anbindung, WhatsApp, KI-Rezeption (der kostenpflichtige KI-Chat für Gäste ist davon ausgenommen, siehe 14b), Programm-Marktplatz, Gutscheine, Pakete, Restaurant-Kasse, Zahlung im Hotel, Kreditkarten-Garantie.

---

## 2. Tech-Stack (entschieden)

| Bereich | Wahl |
| --- | --- |
| Sprache | TypeScript (strict) |
| Web/App | Next.js (App Router), React, Server Actions oder Route Handlers |
| Datenbank | PostgreSQL 16, Schema aus `schema.sql`, Migrationen mit Drizzle ORM (`drizzle-kit`) |
| Jobs | `pg-boss` (Postgres-basierte Queue, kein Redis) |
| Validierung | Zod für alle Eingaben (API, Formulare, Webhooks) |
| Auth (Admin) | Magic-Link per E-Mail (Auth.js mit E-Mail-Provider oder eigene Implementierung mit einmaligem Token, 15 Minuten gültig) |
| E-Mail | Postmark (Transaktions-E-Mails), Templates in React Email |
| Zahlung | Stripe (`stripe` Node SDK), Connect |
| Channel | Channex REST API v1 |
| Tests | Vitest (Unit/Integration gegen echte Postgres-Testdatenbank), Playwright (E2E) |
| Deployment | Docker; Hosting mit Daten in der Schweiz oder EU |
| Zeit | `date-fns` + `date-fns-tz`, Hotel-Zeitzone aus `hotels.timezone` |

**Projektstruktur**

```
/app                     Next.js (öffentliche Seiten, Buchung, Admin)
  /(public)/[locale]/    Website, Suche, Buchung, Buchungsansicht per Token
  /admin/                Admin-Bereich (geschützt)
  /api/                  Route Handlers (Webhooks, öffentliche API)
/src/domain/             reine Logik ohne I/O: pricing, availability, cancellation, state machine
/src/db/                 Drizzle-Schema, Queries, Transaktionen
/src/integrations/stripe/
/src/integrations/channex/
/src/jobs/               pg-boss Worker: holds, channex-outbox, channex-feed, emails
/src/email/              Templates
/tests/                  unit, integration, e2e
schema.sql, SPEC.md, QUESTIONS.md
```

---

## 3. Mandanten und Routing

- Öffentliche Seiten: Hotel über den `Host`-Header (`hotels.primary_domain`) bestimmen. Fallback für Entwicklung und Vorschau: `/h/<slug>/...`.
- Admin unter `/admin`, Hotelwahl über Mitgliedschaft (`hotel_members`). Rollen: `owner` (alles), `manager` (alles ausser Mitglieder und Stripe), `staff` (Kalender lesen, Buchungen lesen, Check-in).
- Plattform-Admins (`users.is_platform_admin`) sehen alle Hotels und können Hotels anlegen.

---

## 4. Datenmodell

Siehe `schema.sql`. Wichtige Regeln:

- `inventory_days` hat eine Zeile pro Zimmertyp und **Nacht** (`night` = Datum, an dem die Nacht beginnt). Ein Aufenthalt vom 1. bis 3. Dezember belegt die Nächte 1. und 2. Dezember.
- `available = total - booked - blocked`. `booked` enthält Holds.
- Fehlende Zeilen in `inventory_days` oder `rates_days` bedeuten **nicht buchbar**. Beim Anlegen eines Zimmertyps werden Zeilen für 18 Monate erzeugt (`total = room_count`), ein täglicher Job ergänzt den nächsten Tag am Ende.
- `rates_days.price_rappen` gilt für `rate_plans.base_occupancy` Personen.
- `bookings.nightly_prices` in `booking_rooms` friert die Preise bei der Buchung ein. Spätere Preisänderungen ändern bestehende Buchungen nie.
- `bookings.public_token`: 32 zufällige Bytes, base64url. Damit sieht der Gast seine Buchung und kann stornieren (`/b/<token>`).
- `bookings.reference`: 8 Zeichen aus `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, Format `XXX-XXXX`, eindeutig.

---

## 5. Domänenlogik

### 5.1 Suche

Eingabe: `checkin`, `checkout`, `adults` (1–10), `children` (0–10), `children_ages` (optional, für Kurtaxe).

Regeln für ein Angebot (Zimmertyp × Rateplan):
1. `checkout > checkin`, `checkin >= heute (Hotelzeit)`, Aufenthalt max. 30 Nächte.
2. Personen passen: `adults <= max_adults`, `children <= max_children`, `adults + children <= max_occupancy`. v1 sucht genau **ein Zimmer** pro Buchung.
3. Für **jede** Nacht `checkin .. checkout-1`: Zeile in `inventory_days` mit `available >= 1`, Zeile in `rates_days` mit `stop_sell = false`.
4. Anreisenacht: `closed_to_arrival = false` und `nights >= min_stay_arrival`; falls `max_stay` gesetzt: `nights <= max_stay`.
5. Abreisetag: falls Zeile für `checkout` existiert, muss `closed_to_departure = false` sein.

Ausgabe pro Angebot: `room_type`, `rate_plan`, `nightly_prices[]`, `rooms_total_rappen`, `tourist_tax_rappen`, `total_rappen`, Stornoregel als Text, Fotos.

### 5.2 Preisberechnung (rein, in `src/domain/pricing.ts`)

Pro Nacht:
```
p = rates_days.price_rappen
wenn persons == 1:          p = p - single_discount_rappen   (nicht unter 1 Rappen)
wenn adults > base_occupancy: p = p + (adults - base_occupancy) * extra_adult_rappen
```
`rooms_total_rappen = Summe aller Nächte`.

Kurtaxe (Regel aus `tourist_tax_rules`: gleicher `canton` und `municipality` wie das Hotel, `category = hotels.tourist_tax_category`, jüngstes `valid_from <= checkin`):
```
für jede Person (Alter am Anreisetag; Erwachsene ohne Alter = adult):
  alter < free_under_age                                  → 0
  reduced_under_age != NULL und alter < reduced_under_age → reduced_rappen
  sonst                                                   → adult_rappen
  Kind ohne Altersangabe → reduced_rappen falls vorhanden, sonst adult_rappen
tourist_tax_rappen = Summe pro Person * nights
```
- Keine Regel gefunden oder `adult_rappen IS NULL` oder `status = 'needs_confirmation'`: Hotel darf nicht `live` gehen, bis es den Satz im Admin bestätigt hat (Admin legt dann eine eigene Zeile mit `status='verified'` an).
- `status = 'none'` bzw. `adult_rappen = 0`: keine Kurtaxe.
- Wenn `tourist_tax_included_in_price = true`: `tourist_tax_rappen` wird angezeigt, aber nicht addiert. Sonst: `total = rooms_total + tourist_tax`.
- Der Buchungsablauf fragt bei Kindern das Alter ab (Pflicht, wenn die Regel Altersgrenzen hat).

Plattformgebühr (nur `source = direct`):
```
platform_fee_rappen = round_half_up(total_rappen * platform_fee_bps / 10000), mindestens 1, kleiner als total
```

Testfälle (müssen als Unit-Tests existieren):
- 2 Nächte à 18000, 2 Erwachsene, base 2, Kurtaxe adult 300 → rooms 36000, tax 1200, total 37200, fee 372.
- 1 Erwachsener, single_discount 2000, 3 Nächte à 15000 → rooms 39000.
- 3 Erwachsene, base 2, extra 4000, 1 Nacht à 20000 → rooms 24000.
- Glarus (adult 440, reduced 220, free <6, reduced <16), 2 Nächte, 2 Erwachsene + Kinder 4 und 10 Jahre → tax (440+440+0+220)×2 = 2200.
- St. Gallen (adult 450, free <16), 1 Nacht, 1 Erwachsener + Kind 15 → tax 450.
- Egnach (`status='none'`) → tax 0.

### 5.3 Hold (Reservierung während der Zahlung)

In **einer** Transaktion:
```sql
UPDATE inventory_days
   SET booked = booked + 1, updated_at = now()
 WHERE room_type_id = $1 AND night >= $2 AND night < $3
   AND total - booked - blocked >= 1
RETURNING night;
```
- Anzahl zurückgegebener Zeilen ≠ Anzahl Nächte → `ROLLBACK`, Antwort „nicht mehr verfügbar“ (HTTP 409).
- Sonst: `guests` anlegen, `bookings` mit `status='hold'`, `hold_expires_at = now() + 30 min`, `booking_rooms` mit eingefrorenen Preisen, `channex_outbox` (availability, Bereich checkin..checkout-1), dann `COMMIT`.
- Das `UPDATE … WHERE available >= 1` ist unter READ COMMITTED sicher gegen gleichzeitige Buchungen (die zweite Transaktion wartet auf die Zeilensperre und prüft die Bedingung neu).
- Danach (ausserhalb der Transaktion) Stripe Checkout Session erstellen (Abschnitt 6.2). Schlägt das fehl: Hold sofort freigeben (5.5).

### 5.4 Bestätigung

Auslöser: Stripe-Webhook (Abschnitt 6.3). Idempotent:
- Buchung `hold` → `confirmed`, `confirmed_at`, Zahlung `succeeded`.
- Buchung bereits `confirmed` → nichts tun.
- Buchung `expired` (Zahlung kam zu spät): erneut Hold-Update versuchen; gelingt es → `confirmed`; sonst sofort volle Rückerstattung inkl. Gebühr, Buchung bleibt `expired`, E-Mail an Gast und Hotel.
- E-Mails einreihen: `booking_confirmed` (Gast), `hotel_new_booking` (Hotel), `pre_arrival` (send_after = checkin − 3 Tage, 10:00 Hotelzeit).

### 5.5 Ablauf und Freigabe

Job alle 60 Sekunden: Buchungen mit `status='hold' AND hold_expires_at < now()` → in Transaktion `booked = booked - 1` für alle Nächte, `status='expired'`, Outbox-Eintrag. Ebenso bei `checkout.session.expired`.

### 5.6 Buchungen aus Channex (OTA)

- Neue Revision: Buchung `source` gemäss `ota_name` (`Booking.com` → `booking_com`, `Expedia` → `expedia`, `Airbnb` → `airbnb`, sonst `other_ota`), `status='confirmed'`, Preise aus `rooms[].days` (Dezimalstring → Rappen), `platform_fee_rappen = 0`. Für jede Nacht `booked = booked + 1` **ohne** Verfügbarkeitsbedingung (die OTA hat schon verkauft).
- Wenn danach `booked + blocked > total`: **Überbuchung**. Buchung trotzdem speichern, E-Mail `overbooking_alert` an Hotel und Plattform, im Admin rot markieren.
- Geänderte Revision: alte Nächte freigeben, neue belegen (gleiche Transaktion), Preise aktualisieren.
- Stornierte Revision: Nächte freigeben, `status='cancelled'`.
- Unbekannter `room_type_id` (nicht gemappt): Buchung mit `room_type_id` NULL ist nicht erlaubt → Revision **nicht** acken, Alarm an Plattform, Fehler in `inbound_events.error`.
- Gast aus `customer` übernehmen (Name, E-Mail falls vorhanden).

### 5.7 Stornierung durch Gast oder Hotel

Gebühr nach Rateplan:
```
deadline = (checkin + checkin_time in Hotelzeitzone) - free_cancel_hours
wenn free_cancel_hours != NULL und jetzt <= deadline: refund = total_rappen (voll)
sonst: fee = round_half_up(rooms_total_rappen * cancel_fee_bps / 10000)
       refund = total_rappen - fee
```
Kurtaxe wird immer erstattet (ist in `total - fee` enthalten, weil die Gebühr nur auf `rooms_total` rechnet). Stornierung durch das Hotel: immer volle Rückerstattung.
Ablauf: Refund bei Stripe (6.4) → bei Erfolg Nächte freigeben, `status='cancelled'`, Outbox, E-Mails `booking_cancelled`. Bei OTA-Buchungen: kein Refund bei uns, Storno im Admin nur Hinweis „Bitte im Portal stornieren“.

### 5.8 Zustandsautomat `bookings.status`

```
hold → confirmed      (Zahlung erfolgreich)
hold → expired        (Zeit abgelaufen / Session abgelaufen)
expired → confirmed   (späte Zahlung, Zimmer noch frei)
confirmed → cancelled (Gast, Hotel, OTA)
confirmed → no_show   (Hotel, frühestens am Tag nach Anreise)
```
Jeder andere Übergang wirft einen Fehler. Jeder Übergang schreibt `audit_log`.

### 5.9 Anzahlung und Restzahlung

- Pro Hotel: `deposit_bps` (1000–10000, 10000 = volle Zahlung, Standard) und `balance_due_days` (1–60, Standard 7).
- Bei der Buchung gilt Anzahlung nur, wenn die Anreise mehr als `balance_due_days` entfernt ist und der Rest mindestens CHF 10 beträgt; sonst volle Zahlung. Grundlage ist der Betrag nach Gutschein. `bookings.balance_rappen`, `balance_due_on = checkin - balance_due_days`.
- Stripe Checkout und `application_fee_amount` gelten nur für die Anzahlung (Gebühr anteilig, `feeShare`). `payments.kind` = `full` | `deposit` | `balance`. Die Buchung wird mit der Anzahlung `confirmed`, der Zustandsautomat ändert sich nicht.
- Restzahlung: Job stündlich. Am Fälligkeitstag Mail `balance_due` mit Link auf die Buchungsseite, nach 3 Tagen `balance_reminder`, 2 Tage vor Anreise `hotel_balance_open` ans Hotel. Jede Stufe einmal. Der Gast bezahlt über `/b/<token>/balance`, das eine frische Stripe-Sitzung erzeugt (Direct Charge, Rest der Gebühr). Webhook mit `metadata.kind = balance` verbucht nur den Rest; abgelaufene oder gescheiterte Rest-Sitzungen geben die Buchung nie frei. Trifft eine Restzahlung nach Storno oder doppelt ein: sofortige Rückerstattung.
- Das Hotel kann den Rest als «vor Ort erhalten» markieren (`balance_onsite_at`), dann keine Aufforderungen mehr.
- Storno: Rückerstattung höchstens `bezahlt - Stornogebühr` (Gutschein anteilig), neueste Zahlung zuerst. Übersteigt die Gebühr das Bezahlte, wird nichts erstattet; der Rest wird als `feeOpenRappen` gemeldet (Audit, Hotel-Mail), das Hotel fordert ihn selbst ein.
- Kein automatisches Abbuchen der Karte: off-session-Zahlungen scheitern oft an 3-D Secure, TWINT ist nicht wiederverwendbar.
- Abnahme: `tests/unit/deposit.test.ts`, `tests/integration/deposit.test.ts`.

---

## 6. Stripe Connect

### 6.1 Onboarding Hotel
- Verbundenes Konto erstellen, bei dem das Hotel Händler ist und Stripe-Gebühren sowie Verluste (Disputes) trägt, mit vollem Stripe-Dashboard für das Hotel (Direct-Charges-Modell). Land `CH`, Geschäftstyp `company`.
- Fähigkeiten anfordern: `card_payments`, `transfers`, `twint_payments`.
- Account Link (`type=account_onboarding`) erzeugen und dem Hotel im Admin als Button anbieten.
- Webhook `account.updated`: `stripe_charges_enabled = charges_enabled`, `stripe_twint_active = capabilities.twint_payments == 'active'`.
- Ein Hotel ist erst buchbar (`status='live'`), wenn `stripe_charges_enabled = true`.

### 6.2 Checkout Session (Direct Charge)
Aufruf mit Header/Option `stripeAccount: hotels.stripe_account_id`:
- `mode: 'payment'`, `currency: 'chf'`, eine Position „Aufenthalt <Hotel>, <checkin>–<checkout>“ mit `unit_amount = total_rappen`.
- `payment_intent_data.application_fee_amount = platform_fee_rappen`.
- `payment_intent_data.metadata = { booking_id, hotel_id }` und `metadata` auf der Session gleich.
- `customer_email` = Gast-E-Mail, `locale` = Sprache.
- `expires_at` = `hold_expires_at` (30 Minuten ist das Minimum bei Stripe Checkout).
- `success_url` = `/b/<public_token>?paid=1`, `cancel_url` = Buchungsseite mit Hinweis.
- Zahlarten automatisch über die Einstellungen; TWINT nur anbieten, wenn `stripe_twint_active` und `total_rappen <= 500000` (TWINT-Limit 5'000 CHF).
- `idempotency_key` = `checkout-<booking_id>`.
- Session-ID in `payments` speichern (`status='pending'`).

### 6.3 Webhooks
Endpoint `POST /api/webhooks/stripe` (für Ereignisse auf **verbundenen Konten**, Signatur mit `STRIPE_WEBHOOK_SECRET_CONNECT` prüfen; Body roh lesen).
Zuerst `INSERT INTO inbound_events … ON CONFLICT DO NOTHING`; war das Ereignis schon da → 200 zurück, nichts tun.

| Ereignis | Aktion |
| --- | --- |
| `checkout.session.completed` mit `payment_status='paid'` | Bestätigung (5.4); `payments` mit PaymentIntent, Methode, Betrag, Gebühr |
| `checkout.session.async_payment_succeeded` | wie oben |
| `checkout.session.async_payment_failed` | Hold freigeben, Zahlung `failed` |
| `checkout.session.expired` | Hold freigeben (5.5) |
| `charge.refunded` | `payments.refunded_rappen`, Status nachführen |
| `charge.dispute.created` | E-Mail an Hotel und Plattform, `audit_log` |
| `account.updated` | 6.1 |

Antwort immer schnell (200); schwere Arbeit in einen Job. Bei Verarbeitungsfehler: `inbound_events.error` setzen, Job mit Retry.

### 6.4 Rückerstattung
Refund auf dem verbundenen Konto mit `payment_intent`, `amount = refund` (Rappen), `refund_application_fee = true` (Gebühr wird anteilig erstattet). `idempotency_key` = `refund-<booking_id>-<amount>`. TWINT-Refunds sind bis 180 Tage nach Zahlung möglich; danach Fehler anzeigen und manuelle Erstattung durch das Hotel verlangen.

---

## 7. Channex

Basis-URL aus `CHANNEX_BASE_URL` (Entwicklung: `https://staging.channex.io/api/v1`; Produktion: von Channex bestätigen lassen). Header `user-api-key: CHANNEX_API_KEY`, `Content-Type: application/json`.

### 7.1 Einrichtung pro Hotel (Admin-Aktion „Channex verbinden“)
- Property, Room Types, Rate Plans in Channex anlegen (oder bestehende IDs eintragen) und die UUIDs in `hotels.channex_property_id`, `room_types.channex_room_type_id`, `rate_plans.channex_rate_plan_id` speichern.
- Vollabgleich: Outbox-Einträge für alle Zimmertypen und Ratepläne über die nächsten 18 Monate.
- Kanalverbindung zu Booking.com macht das Hotel in Channex (nicht unsere Aufgabe in v1).

### 7.2 ARI senden (Outbox)
**Nie** direkt aus Request-Code an Channex senden. Jede Änderung an `inventory_days`/`rates_days` schreibt in derselben Transaktion einen `channex_outbox`-Eintrag (`date_from`..`date_to`).

Worker `channex-outbox` (alle 6 Sekunden):
1. Pro Hotel die fälligen Einträge (`status='pending' AND next_attempt_at <= now()`) holen, nach `kind` und Ziel-ID zusammenfassen (überlappende Bereiche vereinigen).
2. **Aktuelle Werte aus der Datenbank lesen** (nicht die Werte zum Zeitpunkt der Änderung) und in Bereiche gleicher Werte aufteilen.
3. Ein Request pro `kind` und Hotel:
   - `POST /availability` mit `{ "values": [ { "property_id", "room_type_id", "date_from", "date_to", "availability": max(0, total-booked-blocked) } ] }`
   - `POST /restrictions` mit `{ "values": [ { "property_id", "rate_plan_id", "date_from", "date_to", "rate": "180.00", "min_stay_arrival", "max_stay", "closed_to_arrival", "closed_to_departure", "stop_sell" } ] }` — `rate` als Dezimal-String in CHF.
4. Keine Daten in der Vergangenheit senden (vorher auf heute kürzen).
5. Rate Limit: höchstens 10 Availability- und 10 Restrictions-Requests pro Minute und Property (Token-Bucket pro Hotel und `kind`).
6. HTTP 200 → Einträge `sent`. Validierungsfehler im Body → `failed` + Alarm. 429 oder 5xx → Hotel 60 s pausieren, dann exponentiell (60 s, 120 s, 240 s … max 30 min), Alarm nach 15 Minuten ohne Erfolg.

### 7.3 Buchungen empfangen
- Webhook `POST /api/webhooks/channex`: HMAC-Signatur aus Header `x-hmac-signature-256` prüfen (HMAC-SHA256 über `{timestamp}.{raw_body}` mit `CHANNEX_WEBHOOK_SECRET`, Zeitstempel aus `x-hmac-timestamp` höchstens 300 s alt, konstantzeitiger Vergleich). Ereignisse: `booking_new`, `booking_modification`, `booking_cancellation`, `booking_unmapped_room`, `booking_unmapped_rate`.
- Der Webhook stösst nur den Job `channex-feed` an. Zusätzlich läuft `channex-feed` alle 15 Minuten als Rückfallebene (Empfehlung Channex: 15–20 Minuten; häufigeres Abfragen gilt bei der Zertifizierung als unnötig).
- `channex-feed`: `GET /booking_revisions/feed?order[inserted_at]=asc` (paginiert), jede Revision in `inbound_events` (source `channex`, `event_id` = Revisions-ID), verarbeiten nach 5.6, danach `POST /booking_revisions/{id}/ack`. Nur acken, wenn die Verarbeitung erfolgreich war.
- Reihenfolge pro `booking_id` einhalten (älteste zuerst).

### 7.4 Zertifizierung
Channex prüft live per Bildschirmfreigabe: Preisänderung, Sperre, Buchung, Änderung, Storno müssen aus der **echten Admin-Oberfläche** ausgelöst werden. Keine Testskripte, die die API direkt aufrufen, als Ersatz bauen.

---

## 7b. iCal-Abgleich (für Betriebe ohne Channel-Manager)

- **Export:** Pro Zimmertyp eine geheime Adresse `/api/ical/<token>.ics` (Token 64 Zeichen, erneuerbar). Inhalt: Bereiche ausverkaufter Nächte (`total - booked - blocked <= 0`) als «Belegt», ohne Gästedaten. Importierte Belegungen werden nicht zurückgespiegelt. Unbekannter Token: 404.
- **Import:** Bis zu 5 fremde Kalender je Zimmertyp (`ical_feeds`). Der Worker holt sie alle 15 Minuten ab. Belegte Nächte stehen in `ical_feed_nights`, `inventory_days.external_blocked = LEAST(total, Anzahl Kalender)`; die Verfügbarkeit ist `total - booked - blocked - external_blocked`. Jede Änderung schreibt in derselben Transaktion `channex_outbox` und `audit_log`.
- **Sicherheit:** Nur https, keine Zugangsdaten in der Adresse, nur Port 443, keine privaten/internen Adressen (auch nicht über Weiterleitung oder DNS), 10 s Zeitlimit, 2 MB, höchstens 3 Weiterleitungen. Die Adresse (oft mit Schlüssel) kommt nicht ins Audit-Log.
- **Fehler:** Schlägt ein Abruf fehl oder ist die Antwort kein Kalender, bleibt der bisherige Stand (nichts wird freigegeben). Nach 48 Stunden ohne Erfolg Alarm an die Plattform.
- **Doppelbelegung:** Fällt eine importierte Nacht auf eine eigene Buchung, wird sie am Kalender gezählt und im Admin angezeigt; nichts wird storniert.
- **Abnahme:** `tests/unit/ical.test.ts`, `tests/integration/ical.test.ts`.

## 8. Öffentliche Seiten und API

| Route | Zweck |
| --- | --- |
| `GET /[locale]` | Startseite Hotel (Texte, Fotos, Zimmer, Buchungsleiste) |
| `GET /[locale]/book?checkin&checkout&adults&children` | Suchergebnis mit Angeboten |
| `POST /api/bookings` | Body: Angebot (room_type_id, rate_plan_id, Daten, Personen), Gast (Vorname, Nachname, E-Mail, Telefon, Sprache, Notiz, Einwilligung Marketing), AGB akzeptiert → Hold + Checkout Session → `{ checkout_url }`; 409 wenn ausgebucht |
| `GET /b/[token]` | Buchungsansicht für Gast, Status, Stornobedingungen, Button „Stornieren“ |
| `POST /api/bookings/[token]/cancel` | Storno durch Gast (5.7), zeigt vorher die Rückerstattung an (`GET …/cancel-preview`) |
| `POST /api/webhooks/stripe` | 6.3 |
| `POST /api/webhooks/channex` | 7.3 |

Rate-Limit für öffentliche POST-Routen (z. B. 10 pro Minute und IP). Alle Eingaben mit Zod validieren. Preise **immer serverseitig** neu berechnen, nie vom Client übernehmen.

---

## 9. Admin

| Seite | Inhalt |
| --- | --- |
| Kalender | Raster Zimmertyp × Tag (90 Tage scrollbar): verfügbar/gebucht/gesperrt, Preis pro Rateplan. Bereich markieren → Preis setzen, Regeln setzen (Mindestnächte, Anreise/Abreise gesperrt, Verkaufsstopp), Zimmer sperren/freigeben. Wochentage-Filter. Jede Änderung: Transaktion + Outbox + `audit_log`. |
| Buchungen | Liste (Filter: Zeitraum, Quelle, Status), Detail mit Zahlung, Storno-Button mit Vorschau der Rückerstattung, „No-Show“, rote Markierung bei Überbuchung. |
| Einstellungen | Hotelstammdaten, Zimmertypen, Ratepläne, Stornoregeln, Kurtaxe, Check-in/out-Zeiten, Fotos/Texte (DE/EN), Mitglieder, Stripe-Onboarding (Status, Button), Channex (Status, letzte Synchronisation, Fehler). |
| Monatsabrechnung | Pro Monat: Buchungen nach Quelle, Umsatz, Plattformgebühr, Rückerstattungen; Export CSV und PDF. |

---

### 9b. Mehrere Betriebe pro Konto
Ein Benutzer kann Mitglied mehrerer Betriebe sein (`hotel_members`). `/admin` zeigt ab zwei Betrieben (und für Plattform-Admins) eine Übersicht mit Anreisen/Abreisen heute, Gästen im Haus, neuen Anfragen, Buchungen und Umsatz des Monats; im Betrieb gibt es «Betrieb wechseln». `/admin/neu` legt für Inhaber einen weiteren Betrieb im selben Konto an (eigene Bedingungen, Mindestgebühr, Stripe, Abrechnung je Betrieb, ohne neuen Login-Link). Alle Zahlen werden je `hotel_id` aus den zugänglichen Betrieben gebildet. Abnahme: `tests/integration/portfolio.test.ts`.

## 10. E-Mails

| Template | Empfänger | Auslöser |
| --- | --- | --- |
| `booking_confirmed` | Gast | Bestätigung; enthält Referenz, Daten, Zimmer, Preis, Stornoregel, Link `/b/<token>` |
| `hotel_new_booking` | Hotel | jede neue Buchung (auch OTA) |
| `booking_cancelled` | Gast + Hotel | Storno, mit Rückerstattungsbetrag |
| `pre_arrival` | Gast | 3 Tage vor Anreise, 10:00 Hotelzeit; später Link zum Online-Check-in (Modul Gäste) |
| `post_stay` | Gast | 1 Tag nach Abreise, nur mit `marketing_consent`; Vorteil bei Direktbuchung |
| `overbooking_alert` | Hotel + Plattform | 5.6 |
| `checkin_link` | Gast | Modul Gäste, 7 Tage vor Anreise |

Versand über `email_outbox` und Job `emails` (Retry 3×). DE und EN.

---

## 11. Umgebungsvariablen

```
DATABASE_URL=
APP_BASE_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET_CONNECT=
CHANNEX_BASE_URL=https://staging.channex.io/api/v1
CHANNEX_API_KEY=
CHANNEX_WEBHOOK_SECRET=
POSTMARK_SERVER_TOKEN=
EMAIL_FROM=
PLATFORM_ALERT_EMAIL=
AUTH_SECRET=
FILE_STORAGE_*            # für Fotos/Signaturen (S3-kompatibel, Region CH/EU)
```

---

## 12. Meilensteine und Abnahmekriterien

Jeder Punkt unter „Abnahme“ ist ein automatischer Test (Vitest oder Playwright).

### M1 – Kern (ohne Fremdsysteme)
Aufgaben: Projekt-Setup, Schema/Migrationen, Seed-Daten (Abschnitt 12.6), Domänenlogik 5.1–5.3, 5.5, 5.8, Buchungsseiten mit Fake-Zahlung (`PAYMENT_PROVIDER=fake`, bestätigt sofort).
Abnahme:
- Preis-Testfälle aus 5.2 grün.
- 20 parallele Hold-Requests auf das letzte freie Zimmer: genau 1 Erfolg, 19× HTTP 409, `booked` am Ende = 1.
- Abgelaufener Hold gibt alle Nächte frei.
- Suche respektiert Mindestnächte, Anreise/Abreise gesperrt, Verkaufsstopp, Personenzahl.
- Mandantentest: Hotel A kann über keine Route Daten von Hotel B lesen.

### M2 – Stripe und Admin
Aufgaben: 6.1–6.4, Admin (Abschnitt 9) inkl. Magic-Link-Login, E-Mails (10).
Abnahme (Stripe-Testmodus):
- Checkout als Direct Charge mit Application Fee = 1,9 % (190 bps, Standard in `hotels.platform_fee_bps`); nach Webhook ist die Buchung `confirmed`, `payments` korrekt.
- Doppelt gesendeter Webhook ändert nichts.
- Storno vor Frist: volle Rückerstattung inkl. Gebühr; nach Frist: Gebühr nach Rateplan.
- `checkout.session.expired` gibt Hold frei.
- Kalender-Änderung erzeugt Outbox-Einträge und `audit_log`.

### M3 – Channex
Aufgaben: 7.1–7.4, Überbuchungs-Warnung, Monatsabrechnung.
Abnahme (Channex-Staging + gemockte Tests):
- Preisänderung im Admin → innerhalb 30 s ein gebündelter `POST /restrictions` mit korrekten Datumsbereichen.
- Hold → `POST /availability` mit reduziertem Wert.
- Rate Limit wird nie überschritten (Test mit 500 Änderungen in 1 Minute).
- Feed-Revision `new` → Buchung angelegt, Nächte belegt, Ack gesendet; `modified` und `cancelled` korrekt; unbekanntes Mapping → kein Ack, Alarm.
- Webhook mit falscher Signatur → 401.

### M4 – Modul „Gäste“ (Phase 2, siehe Abschnitt 14)

### 12.6 Seed-Daten
Hotel „Demo Gasthof“, Kanton `GL`, Gemeinde `Glarus` (Kurtaxe aus `tourist_tax_rules`), 3 Zimmertypen (Einzel 4 Zimmer max 1; Doppel 8 Zimmer max 2; Familie 2 Zimmer max 4), je 2 Ratepläne (Flexibel: gratis bis 48 h; Nicht stornierbar: 10 % günstiger, `cancel_fee_bps = 10000`), Preise 12000/18000/26000 Rappen, Freitag/Samstag +2000, Mindestnächte 2 an Samstagen.

---

## 13. Externe Dokumentation (verbindlich)

- Stripe Direct Charges: https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted
- Stripe TWINT: https://docs.stripe.com/payments/twint
- Stripe Merchant of Record: https://docs.stripe.com/connect/merchant-of-record
- Channex ARI: https://docs.channex.io/api-v.1-documentation/ari
- Channex Rate Limits: https://docs.channex.io/api-v.1-documentation/rate-limits
- Channex Bookings / Feed / Ack: https://docs.channex.io/api-v.1-documentation/bookings-collection
- Channex Webhooks: https://docs.channex.io/api-v.1-documentation/webhook-collection
- Channex PMS Certification: https://docs.channex.io/api-v.1-documentation/pms-certification-tests

---

## 14. Modul „Gäste“ (Phase 2, zuschaltbar über `hotel_modules.module='guests'`)

Zweck: Gästeregister nach kantonalem Recht digital führen, Check-in vorbereiten, Kurtaxe-Liste.

**Kantonale Regeln** stehen in `canton_rules` (siehe `schema.sql`). Stand 6.11.2026:

| Kanton | Pflicht | Aufbewahrung | Unterschrift |
| --- | --- | --- | --- |
| SG | Hotelmeldeschein vollständig; Gruppen: Teilnehmerliste genügt; an Polizei auf Verlangen | 5 Jahre | nein |
| TG | Personalien und Herkunft erfassen, der Polizei zur Verfügung halten | nicht geregelt → 5 Jahre verwenden | nein |
| GL | Meldeschein nach amtlichem Ausweis, unterschrieben; an Kantonspolizei auf Verlangen | 3 Jahre | ja |
| AR | Meldeschein bei Ankunft, Form frei | 5 Jahre | nein |
| AI | nicht verifiziert → `QUESTIONS.md` | 5 Jahre (Annahme) | nein |

Bund: Ausländische Gäste müssen nach Art. 16 AIG der kantonalen Behörde gemeldet werden. Eine Vernehmlassung (bis 27.11.2026) sieht eine elektronische Meldung ohne Unterschrift über EasyGov vor. Deshalb eine Schnittstelle `RegistrationReporter` vorsehen mit Implementierungen `NoopReporter` (heute), `AvsReporter` (siehe unten) und später `EasyGovReporter`.

**AVS-Meldewesen (wichtig):** In mehreren Regionen läuft Meldeschein, Kurtaxe-Abrechnung, Gästekarte und HESTA-Meldung über das System von AVS Abrechnungs- und Verwaltungs-Systeme GmbH: bestätigt für St.Gallen-Bodensee Tourismus und die Gemeinde Glarus (meldeschein.avs.de/glarus). AVS bietet laut St.Gallen-Bodensee Tourismus kostenlose Schnittstellen zu über 100 Hotelprogrammen; Ablauf: Hotel meldet sein System der Tourismusorganisation, erhält ein Konfigurationsdokument, Daten fliessen nur vom Hotelsystem zu AVS. Für Hotels in diesen Regionen ist `AvsReporter` der Weg für Meldeschein, Kurtaxe und HESTA zugleich. Schnittstellen-Spezifikation bei AVS anfragen (QUESTIONS.md), nicht raten.

**Funktionen**
1. Job sendet `checkin_link` 7 Tage vor Anreise (bei späterer Buchung sofort). Link `/b/<token>/checkin`.
2. Online-Formular pro Person; Felder wie `guest_registrations` (Pflicht: Name, Geburtsdatum, Nationalität, Adresse, Land, Ausweistyp und -nummer, Ankunft, Abreise; optional Autokennzeichen). Bei `signature_required` Unterschriftsfeld (Canvas → PNG).
3. Gruppenbuchung (> 5 Personen, Kanton erlaubt Liste): nur Hauptperson + Teilnehmerliste (Name, Geburtsdatum, Nationalität).
4. Personal bestätigt am Empfang, dass der Ausweis gesehen wurde (`verified_by_staff_at`).
5. Admin: Tagesliste Anreisen mit Check-in-Status; Export Gästeregister als CSV und PDF für Zeitraum (für Polizei auf Verlangen); Kurtaxe-Liste pro Monat (Personen, Nächte, steuerpflichtig ja/nein).
6. Aufbewahrung: `retention_until = departure_date + retention_years`; täglicher Job löscht abgelaufene Einträge und Signaturen.
7. Datenschutz: Ausweisnummer und Geburtsdatum verschlüsselt speichern (Anwendungsschicht, Schlüssel aus Env), Zugriff nur `owner`/`manager`/`staff` des Hotels, jeder Export in `audit_log`.

Abnahme M4:
- Gast füllt Formular aus, Daten erscheinen in Tagesliste; GL-Hotel verlangt Unterschrift, SG-Hotel nicht.
- Export CSV enthält alle Pflichtfelder für den Zeitraum, Export ist im `audit_log`.
- Löschjob entfernt Einträge nach Ablauf, nicht vorher.

---

## 14b. Modul „KI-Chat“ (kostenpflichtig, zuschaltbar über `hotel_modules.module='ai_chat'`)

Zweck: Ein Chat auf der Hotel-Website und auf der Buchungsseite des Gastes (`/b/<token>`) beantwortet Fragen zum Haus und zur Umgebung, vor und während des Aufenthalts (Frühstückszeiten, WLAN, Öffnungszeiten, Ausflugstipps, Anreise). Er antwortet **nur** aus den Daten des Hotels (`hotelKnowledge()`, `src/services/knowledge.ts`). Der Betreiber verkauft das Modul als Premium-Funktion mit Marge.

**Grenzen (wichtig)**
- Keine Preis- und Verfügbarkeitsabfragen: Der Chat nennt keine Zimmerpreise und prüft keine Verfügbarkeit, sondern verweist auf die Suchleiste. Veröffentlichte Preise aus Speisekarte, Zusatzleistungen und Angeboten darf er nennen.
- Er ändert nie Buchungen, löst keine Zahlungen aus und fragt nicht nach persönlichen Daten.
- Er gibt sich als KI zu erkennen. Was er nicht weiss, leitet er als Anfrage ans Hotel weiter (bestehende `inquiries`, mit Push und Mail); der Gast gibt dafür Name, E-Mail und Text ein, der Gesprächsverlauf wird der Anfrage vom Browser mitgegeben.
- Antwortsprache = Sprache des Gastes, soweit das Hotel sie in `hotelLocales` führt, sonst Deutsch.

**Technik**
- `src/services/chat.ts`, Route `POST /api/chat` (Body: `hotel` aus dem Host, `session`, `messages`, `lang`). Modell aus `CHAT_MODEL` (Standard `claude-haiku-5-5`), Schlüssel `ANTHROPIC_API_KEY`, derselbe fetch-Mechanismus wie in `translate.ts` (für Tests abfangbar). Keine Streaming-Antworten in der ersten Version.
- Schutz: Rate-Limit pro IP und Hotel, höchstens 20 Nachrichten pro Gespräch, höchstens 500 Zeichen pro Nachricht, höchstens 500 Ausgabe-Tokens, nur die letzten 10 Nachrichten gehen ans Modell. Das Hotelwissen steht im System-Prompt, Anweisungen des Gastes können es nicht überschreiben.
- Alle Abfragen mit `hotel_id`. Der Chat erscheint als schwebendes Widget im gemeinsamen Seitenrahmen (`components/public/Shell.tsx`), auf allen Seiten des Hotels und auf `/b/<token>` (dort mit `surface='booking'`), sobald das Modul läuft. Das Hotel muss nichts platzieren; für alle Hotels gleich.

**Gespräch und Kontingent**
- Ein **Gespräch** ist eine Sitzung (`ai_usage`, eine Zeile pro Sitzung): sie endet nach 30 Minuten Pause oder nach 20 Nachrichten, danach beginnt ein neues Gespräch. Die Sitzungs-ID vergibt der Server.
- **Gesprächstexte werden nicht gespeichert.** `ai_usage` hat nur Zähler: Hotel, Monat, Sitzung, Anzahl Nachrichten, Eingabe- und Ausgabe-Tokens, Zeitpunkte.
- Tarife stehen als Daten in `ai_plans` (Code, Name, Preis in Rappen, enthaltene Gespräche pro Monat, Zusatzpaket: Grösse und Preis, `active`, `public`). Start: `basic` = CHF 19.00, 250 Gespräche, Zusatzpaket 100 Gespräche = CHF 5.00. `mini` = CHF 4.90, 50 Gespräche, ohne Zusatzpakete, nicht öffentlich (`public=false`), wird vom Betreiber später freigeschaltet. Preise ohne MWST.
- Beim Einschalten speichert das Hotel eine Kopie der Konditionen in `hotel_modules.settings` (`terms`: Tarif, Preis, Gespräche, Paketgrösse, Paketpreis, `acceptedAt`, `acceptedBy`), spätere Preisänderungen gelten für bestehende Hotels erst nach Ankündigung.
- Ist das Kontingent des Monats aufgebraucht: **Standard = Pause bis Monatsende**. Der Chat nennt das freundlich und bietet die Anfrage ans Hotel an, ohne Aufruf des Modells.
- Option **«Bei Limit weiterlaufen»**: Das Hotel setzt ein Monatsbudget für Zusatzpakete (`settings.overageBudgetRappen`, 0 = aus). Jedes angebrochene Paket zählt voll; ist das Budget erreicht, gilt wieder die Pause.
- Zusätzlich gibt es eine technische Obergrenze pro Hotel und Monat (`AI_CHAT_HARD_CAP`, Standard 5000 Gespräche), unabhängig vom Tarif.

**Abrechnung**
- Der Modulpreis und die Zusatzpakete werden für den Vormonat in derselben Monatsbelastung wie die Mindestgebühr erhoben (`platform_charges`, neue Spalten `ai_module_rappen`, `ai_packs_rappen`); Betrag = Differenz Mindestgebühr + Modulpreis + Pakete. Eine Belastung pro Monat, gleiche Wiederholversuche.
- Einschalten verlangt eine hinterlegte Karte (`billing_payment_method_id`) und die Preisbestätigung. Der Aktivierungsmonat ist kostenlos. Kündigung ist jederzeit möglich und wirkt zum Monatsende (`settings.endsAt`).
- Admin → Abrechnung zeigt die KI-Nutzung des Monats (Gespräche, Kontingent, Pakete, Betrag).
- Die Kosten des Betreibers (Tokens) lassen sich mit `ai_usage` auswerten; Preise pro Million Tokens als Einstellung `CHAT_COST_IN_USD_PER_MTOK`, `CHAT_COST_OUT_USD_PER_MTOK` (Standard 0.10 und 0.50, Stand November 2026, vor Gebrauch bei Anthropic prüfen).

**Ankunftsinfos (Codes, WLAN)**
- Codes und Passwörter gehen nie in den Prompt. `hotels.content.arrivalInfo` und neu `room_types.arrival_info` (überschreibt die des Hotels) werden nur von `src/services/arrival.ts` gelesen: gültiger Buchungslink dieses Hotels, Status `confirmed`, heute zwischen Anreise- und Abreisetag (Hotelzeit). Die Prüfung macht der Server; `surface='booking'` gilt nur mit gültigem Link.
- Fragt der Gast danach, antwortet das Modell kurz und hängt `[[ARRIVAL]]` an (nur, wenn erlaubt). Das Widget holt dann `POST /api/chat/arrival` und zeigt den Text als feste Karte. Dieselben Infos stehen als Abschnitt auf `/b/<token>`. Ausserhalb des Aufenthalts: 403, der Chat verweist auf die Buchungsseite.
- `arrival_info` erscheint nicht im Audit-Log und nicht in Suchergebnissen.

**Recht**
- Neue Ziffer in den Bedingungen für Gastgeber (Modul, Preis, Kontingent, Zusatzpakete, monatliche Kündigung, Anbieter im Ausland, Hinweis, dass KI-Antworten Fehler enthalten können) mit neuer Version; Datenschutzerklärung der Plattform und der Hotel-Websites ergänzen. Beides vom Juristen prüfen lassen.

Abnahme KI-Chat:
- Modul aus: `POST /api/chat` antwortet ohne Aufruf des Modells mit einem Fehler.
- Der Prompt enthält das Wissen des eigenen Hotels und nie das eines anderen; er enthält keine Zimmerpreise und keine Verfügbarkeit.
- Ein Gespräch zählt einmal pro Sitzung; nach 20 Nachrichten oder 30 Minuten Pause beginnt ein neues.
- Kontingent erreicht ohne Budget: Pause-Antwort, kein Aufruf des Modells. Mit Budget: Zusatzpakete bis zum Budget, dann Pause. Obergrenze pro Hotel gilt immer.
- `ai_usage` enthält keine Textspalten; Gesprächstexte erscheinen nirgends in der Datenbank oder im Log.
- Rate-Limit und Längenlimits greifen.
- Einschalten nur mit Karte und Preisbestätigung; die Konditionen werden kopiert.
- Abrechnung: Betrag = Mindestgebühr-Differenz + Modulpreis + Pakete; Aktivierungsmonat kostenlos; zweiter Lauf erzeugt nichts doppelt; Kündigung wirkt zum Monatsende.
- Weiterleitung als Anfrage erzeugt eine `inquiries`-Zeile mit Push.
- Ankunftsinfos: nie im Prompt; nur mit gültigem Link, bestätigter Buchung und im Aufenthaltszeitraum; Zimmertext überschreibt Hoteltext; nicht im Audit-Log.

---

### 14b.1 Auswertung «Was der Chat nicht wusste»
`ai_usage.unanswered` zählt Antworten mit Weiterleitungs-Marker. Der Admin zeigt je Monat Gespräche, Fragen, nicht beantwortete Fragen (Anzahl und Anteil) und Gespräche mit Lücke. Nur Zähler, nie Texte oder Themen. Abnahme: Test «Auswertung» in `tests/integration/ai-chat.test.ts`.

## 14c. Buchhaltung des Betreibers (Export für Banana)

- Am 5. jedes Monats schreibt der Worker die Erträge des Vormonats als `pontivo-JJJJ-MM.txt` in `ACCOUNTING_EXPORT_DIR` (Server: `/opt/pontivo/buchhaltung`). Von Hand: `npm run export:banana -- JJJJ-MM`.
- Format: Textdatei mit Spaltenüberschriften (`Date, DocInvoice, Description, AccountDebit, AccountCredit, Amount, ExternalReference`), Tabulator, Datum `yyyy-mm-dd`, Betrag mit Punkt, UTF-8. Betreiber nicht MWST-pflichtig: kein `VatCode`.
- Zeilen je Hotel und Monat: Plattformgebühr (netto nach Rückerstattungen, bereits per Stripe eingezogen), Mindestgebühr-Differenz, KI-Modul, KI-Zusatzpakete. Die drei letzten nur bei erfolgreicher Belastung (`status = succeeded`); offene oder fehlgeschlagene stehen nicht in der Datei.
- Konten (Soll Durchlaufkonto Stripe, Haben je Ertragsart) aus Umgebungsvariablen `BANANA_ACCOUNT_*`, müssen zum eigenen Kontenplan passen. Die Bankseite kommt aus dem Kontoauszug der Bank, nicht von Pontivo.
- Abnahme: `tests/integration/accounting.test.ts`.

## 14d. Modul „Upselling“ (provisionsbasiert, zuschaltbar über `hotel_modules.module='upsell'`)

Das Hotel erfasst Zusatzangebote (`upsell_items`: Name/Beschreibung DE/EN, Preis in Rappen, Einheit pro Buchung/Nacht/Person/Person und Nacht, Höchstmenge). Gäste einer **bestätigten** Buchung, die dem Erhalt von Angeboten zugestimmt haben (`guests.marketing_consent`), bekommen **7 Tage vor Anreise, 10:00 Hotelzeit** die Mail `upsell_offer` (liegt der Zeitpunkt in der Vergangenheit: sofort, solange die Anreise noch bevorsteht). Sie führt auf `/b/<token>/upsell`.

- **Preise nur serverseitig:** Der Gast sendet nur Angebots-ID und Menge. Menge 0 wird ignoriert; unbekannt, inaktiv, doppelt, negativ oder über dem Maximum (pro Person: Personenzahl) wird abgelehnt (`priceSelection`).
- **Zahlung:** Stripe Checkout als Direct Charge auf das Konto des Hotels (`createPaymentCheckout`), Metadaten `upsell_order_id`. **Provision 5 %** (`UPSELL_PROVISION_BPS = 500`) als `application_fee_amount`, in der Bestellung festgehalten (`fee_bps`, `fee_rappen`). Keine Grundgebühr. Die Herkunft steht in `upsell_orders.source` (`email`, später `chat`).
- **Webhook:** `checkout.session.completed` → `markUpsellPaid` (idempotent, Bestätigung an Gast, Hinweis an Hotel, Push, Audit). Ereignisse eines fremden Kontos werden abgelehnt; abgelaufene/gescheiterte Zahlung → Bestellung `cancelled`.
- **Einschalten:** Admin → Upselling, mit bestätigter Provision (Bedingungen Ziffer 8), nur bei eingerichteter Online-Zahlung. Ausschalten sofort; geplante Angebots-Mails werden storniert. Bei Stornierung oder Verschiebung einer Buchung werden Angebots-Mails gelöscht bzw. neu geplant.
- **Nicht enthalten:** Rückerstattungen (im Stripe-Dashboard des Hotels), Berücksichtigung der Provision im Monatsbericht, Angebote je Zimmertyp.

## 14e. GEO: Sichtbarkeit für Suchmaschinen und KI-Assistenten (alle Hotels, ohne Zusatzkosten)

Alles wird aus den vorhandenen Hotel-Daten erzeugt, pro Hotel automatisch, ohne Hotel-spezifischen Code:

- **`/sitemap.xml`**: alle veröffentlichten Seiten in allen Sprachen mit `hreflang` und `x-default`, `lastmod` aus der Seite.
- **`/robots.txt`**: Suchmaschinen und KI-Crawler dürfen alles Öffentliche lesen; gesperrt sind `/admin`, `/api/`, `/b/` (persönliche Buchungslinks), `/v/`, `/vorschau`. Verweis auf die Sitemap (nur bei Hotel-Domain).
- **`/llms.txt`** (llmstxt.org): Zusammenfassung in der Hauptsprache des Hotels: Fakten (Adresse, Kontakt, Check-in/-out, Sprachen, Zahlarten, Fakten-Bausteine), Zimmer mit Belegung und «ab»-Preis der nächsten 12 Monate, Direktbuchungs-Link, FAQ, Textbausteine, Seiten, weitere Sprachen. Nur veröffentlichte Inhalte.
- **Strukturdaten** (schema.org JSON-LD): zusätzlich zu Hotel, FAQ, Restaurant jetzt `containsPlace` (HotelRoom mit Belegung, Beschreibung, Bild) und `potentialAction` (ReserveAction mit Buchungs-URL).
- **`canonical`** pro Seite (Vorschau-Adresse `/h/<slug>` verweist auf die Hotel-Domain).
- Erreichbar über die Hotel-Domain und für die Vorschau unter `/h/<slug>/sitemap.xml` und `/h/<slug>/llms.txt`.
- **Später (Zusatzpaket):** Destinations-Paket (Gemeinde/Region: Inhalte zu Ausflügen, Events, Anreise für mehrere Betriebe).

## 15. Offene Fragen (nicht raten, in `QUESTIONS.md` führen)

- Channex Produktions-URL und Preise für Staging/Produktion.
- Kurtaxe: Zeilen mit `status='needs_confirmation'` in `tourist_tax_rules` (Wildhaus-Alt St. Johann, Speicher, Hundwil) und AI-Satz (2.50 laut Verordnung, 2.70 laut Drittquelle). Neue Gemeinden beim Onboarding eines Hotels erfassen.
- AVS-Schnittstelle (Format, Zugang, Kosten) für Meldeschein, Kurtaxe und HESTA.
- Gästemeldung Appenzell Innerrhoden.
- Ob Hotels mit eigenem Channel-Manager (z. B. Hotel-Spider) statt Channex angebunden werden (eigene Integration, nicht v1).
- Rechtstexte (AGB Gäste, Vertrag Hotel, Datenschutzerklärung) liefert der Betreiber.
