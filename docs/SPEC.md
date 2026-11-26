# SPEC – Buchungsplattform für Hotels (v1)

Stand: 6.11.2026 · Sprache der Spezifikation: Deutsch · Code, Tabellen, Variablen: Englisch

Diese Datei ist der Auftrag für KI-Coding-Agenten. Sie ist zusammen mit `schema.sql` die einzige Quelle der Wahrheit.

**Einstieg:** `docs/MODULES.md` zeigt je Modul die Seiten, Tabellen und SPEC-Abschnitte auf einen Blick (erzeugt, nicht von Hand gepflegt).

---

## 0. Arbeitsregeln für Agenten

1. **Lies zuerst diese Datei ganz, dann `schema.sql`.** Baue nur, was hier steht. Fehlt etwas, schreibe die Frage in `QUESTIONS.md` und triff die einfachste sichere Annahme; markiere sie im Code mit `// ASSUMPTION:`.
2. **Erfinde keine externen API-Felder.** Für Stripe und Channex gelten die verlinkten Dokumentationen (Abschnitt 13). Bei Unklarheit: Doku lesen, nicht raten.
3. **Arbeite in den Meilensteinen aus Abschnitt 12**, einer nach dem anderen. Ein Meilenstein ist fertig, wenn alle Abnahmekriterien als automatische Tests grün sind.
4. **Geld immer als Integer in Rappen**, nie Float. Kalendertage als `DATE`, Zeitpunkte als `timestamptz` (UTC); Anzeige und Fristen in der Zeitzone des Hotels.
5. **Jede Datenbankabfrage filtert nach `hotel_id`** (Mandantentrennung). Kein Endpoint gibt Daten eines anderen Hotels heraus.
6. **Keine Kartendaten speichern oder berühren.** Zahlungen laufen ausschliesslich über Stripe: Checkout gehostet (Weiterleitung), Checkout eingebettet (SPEC 19.25) oder Payment Element (SPEC 19.52). Die Karteneingabe liegt immer in einer Oberfläche von Stripe (Rahmen von Stripe.js), nie in unseren eigenen Feldern.
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

**Nicht in v1** (nicht bauen): eigene Hotelverwaltung ausser Modul „Online-Check-in“ (Phase 2), Google-Hotel-Anbindung, WhatsApp, KI-Rezeption (der kostenpflichtige KI-Chat für Gäste ist davon ausgenommen, siehe 14b), Programm-Marktplatz, Gutscheine, Pakete, Restaurant-Kasse, Zahlung im Hotel, Kreditkarten-Garantie.

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
| `pre_arrival` | Gast | 3 Tage vor Anreise, 10:00 Hotelzeit; später Link zum Online-Check-in (Seite «Online-Check-in», Modul `guests`) |
| `post_stay` | Gast | 1 Tag nach Abreise, nur mit `marketing_consent`; Vorteil bei Direktbuchung |
| `overbooking_alert` | Hotel + Plattform | 5.6 |
| `checkin_link` | Gast | Modul Online-Check-in, 7 Tage vor Anreise |

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

### M4 – Modul „Online-Check-in“ (Phase 2, siehe Abschnitt 14)

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

## 14. Modul „Online-Check-in“ (Phase 2, zuschaltbar über `hotel_modules.module='guests'`)

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

## 14f. Buchender KI-Chat (Option im Modul «KI-Chat», `settings.bookingEnabled`)

Das Hotel kann im Admin einschalten, dass der Chat auf der **Website** (nicht auf der persönlichen Buchungsseite) Verfügbarkeit und Preise prüft. Voraussetzung: Modul läuft, Online-Zahlung eingerichtet.

- **Werkzeuge** (Anthropic Tool Use, `src/services/chat-booking.ts`): `check_stay` (Daten, Personen) → Optionen mit **serverseitig berechnetem** Gesamtpreis (`searchOffers`); `show_offer` (`option_id`) → Server prüft Verfügbarkeit und Preis **neu** und erzeugt eine **Angebotskarte** (nie vom Modell).
- **Buchung:** Die Karte führt auf das normale Buchungsformular `/<lang>/book?…&plan=…` (Name, AGB, Anzahlung/Zahlung per Stripe Checkout). Der Chat erfasst **keine Personendaten** und löst keine Zahlung aus. Gebunden ist der Gast erst nach der Zahlung dort.
- **Regeln im Prompt:** Preise nur aus Werkzeugen, nichts selbst rechnen, keine Zusagen, keine Namen/E-Mail/Karten im Chat.
- **Kosten/Missbrauch:** höchstens 4 Modellaufrufe pro Gästenachricht (`MAX_TOOL_ROUNDS`), gleiche Gesprächs-Kontingente und Rate-Limits wie der normale Chat.
- **Nicht enthalten:** Zahlungslink direkt aus dem Chat, Buchung mit Extras/Gutschein im Chat, Mail/WhatsApp/Voice.

## 16. PMS Stufe A: Rezeption und Rechnung (Konzept: `docs/PMS-KONZEPT.md`)

Freigegeben am 14.11.2026. Alles modular (16.1), additiv zum bestehenden Bestand, keine Hotel-Sonderlogik. Annahmen in `QUESTIONS.md`. Rechnung/MWST vor dem produktiven Einsatz von einem Treuhänder prüfen lassen.

### 16.1 Modul-Register
- `src/domain/modules.ts`: Liste der ein-/ausschaltbaren Module (`frontdesk`, `invoicing`, `vouchers`, `inquiries`) mit Schlüssel, Beschreibung, Abhängigkeiten, Standard (alle an) und Menüpunkten. Gespeichert in `hotel_modules(hotel_id, module, enabled)`; **keine Zeile = Standard**. Die feste CHECK-Liste der Tabelle entfällt (Migration 0027).
- Kostenpflichtige Module (`ai_chat`, `upsell`) behalten ihren eigenen Einschalt-Ablauf und stehen nicht im Register.
- Ausgeschaltet: Menüpunkt weg (`adminNav(hotel, setup, hidden)`), Seite per Adresse 404 (`requireModule`), Daten bleiben. Hat ein Sammelpunkt nur noch einen Reiter, wird er ein einfacher Punkt.
- Seite **Funktionen** (Admin, Rolle manager): Schalter pro Modul. Ausschalten nicht möglich, solange ein abhängiges Modul läuft; Einschalten nicht, solange eine Abhängigkeit fehlt. Jeder Wechsel im `audit_log`.

### 16.2 Zimmer, Zimmerplan, Tagesliste (Modul `frontdesk`)
- Tabelle `rooms` (Hotel, Zimmertyp, Nummer, Etage, aktiv, Notiz, Sortierung; Nummer pro Hotel eindeutig). `booking_rooms.room_id` (leer = nur Zimmertyp, wie bisher). **Optional**: ohne Zimmer läuft alles wie heute.
- Die Verfügbarkeit (Zähler pro Zimmertyp, Channex, iCal) ändert sich nicht. Die Zuweisung ist eine zweite Schicht.
- Zuweisung nur auf ein Zimmer **desselben Zimmertyps** und nur, wenn das Zimmer in diesen Nächten nicht schon bei einer anderen Buchung (`hold`, `confirmed`) zugewiesen ist. Manuell (Auswahl bei der Buchung oder im Zimmerplan) und «Automatisch zuweisen» (nächste 14 Tage, nicht zugewiesene Buchungen, Zimmer mit der kürzesten Lücke zuerst, bestehende Zuweisungen bleiben).
- Zimmerplan: Zeilen = Zimmer nach Typ, Spalten = 14 Tage ab einem Datum (blätterbar), Balken pro Buchung (Name, Buchungsnummer, Link), oben Zeile «Nicht zugewiesen». Sperre eines Zimmers (`active = false`) zeigt es ausgegraut. Kein Drag & Drop in v1.
- Tagesliste «Heute»: Anreisen (Zimmer, Check-in-Status, Restzahlung offen), Abreisen (offene Posten/Rechnung), im Haus. Zimmer anlegen: Knopf «Zimmer 1…n anlegen» aus `room_count` (nur sichtbar, solange Zimmer fehlen). Zimmer verwalten: Liste je Zimmertyp, Tippen öffnet die Seitenleiste (Typ, Nummer, Etage, Notiz, Sperren, Löschen); Typwechsel nur ohne zugewiesene Buchungen.
- Jede Zuweisung im `audit_log`; Mandantentrennung über `hotel_id`.

### 16.3 Rechnung und Kasse (Modul `invoicing`)
- Einstellungen pro Betrieb (`hotels.content.invoicing`): MWST-pflichtig ja/nein, MWST-Nummer, Satz Beherbergung (Standard 3,8 %), Satz übrige Leistungen (8,1 %), IBAN, Zahlungsfrist, optional automatischer E-Mail-Versand (standardmässig aus), optional QR-IBAN (dann QR-Referenz, Referenztyp `QRR`), Fusszeile. Nicht MWST-pflichtig = Rechnungen ohne MWST.
- Tabellen: `invoices` (Nummer lückenlos pro Betrieb und Jahr, Art `invoice`/`credit_note`, Datum, Empfänger, Summen, Status `draft`/`issued`, Verweis auf Buchung und bei Gutschrift auf die Rechnung), `invoice_lines` (Beschreibung, Menge, Einzelpreis, Betrag inkl. MWST, MWST-Satz in Basispunkten, Kategorie), `invoice_counters`, `folio_items` (Posten auf der Buchung, z. B. Minibar, bis sie fakturiert sind), `onsite_payments` (Zahlung vor Ort: bar, Karte, TWINT, Bank; Betrag, Datum, Notiz, Nutzer).
- **Rechnung aus Buchung:** Zeilen aus Übernachtungen (`booking_rooms`), Extras (`booking_extras`), Kurtaxe (ohne MWST), offenen Posten (`folio_items`). Abzug Gutschein. Bereits bezahlte Beträge (Stripe, vor Ort) erscheinen als Zahlungen, der offene Betrag wird ausgewiesen. Ist nichts offen, heisst das Dokument **Quittung**.
- **Unveränderlich:** Entwurf ist änderbar (Empfänger, Zeilen), «Ausstellen» vergibt die Nummer und sperrt. Korrektur nur per **Gutschrift** (eigene Nummer, negative Beträge).
- MWST: Preise sind Bruttopreise; MWST = Betrag × Satz / (10000 + Satz), pro Satz gerundet und ausgewiesen.
- **QR-Rechnung** (Swiss Payment Standards) für offene Beträge: Zahlteil mit QR-Code, Konto = IBAN des Betriebs, Referenztyp `NON`, Rechnungsnummer unter «Zusätzliche Informationen». Nur wenn IBAN gesetzt und Betrag offen.
- **Druckansicht** `/admin/<hotel>/invoices/<id>/print` (A4, Browser «Als PDF speichern»); Versand per Mail optional: Knopf auf der Rechnung oder automatisch beim Ausstellen; die Mail enthält den Link `/b/<token>/rechnung/<id>` (kein PDF-Anhang).
- **Zahlung vor Ort:** Eintrag in `onsite_payments`; schliesst eine offene Restzahlung (`balance_onsite_at` wie bisher) und die Rechnung. Rückbuchungen nur per Gutschrift/Erfassung eines negativen Betrags mit Notiz.
- Admin: Reiter «Rechnungen» (Liste, Entwurf aus Buchung, Posten erfassen, Ausstellen, Gutschrift, Zahlung erfassen).
- Nicht in Stufe A: Sammelrechnungen für Gruppen, Buchungen auf Firmenkonto, Mahnwesen, CAMT-Abgleich.

## 17. PMS Stufe B: Betrieb (Konzept: `docs/PMS-KONZEPT.md`)

Reihenfolge: 17.1 Housekeeping, 17.2 Gäste-Notizen und Tags, 17.3 Berichte, 17.4 Rollen pro Modul, 17.5 Mail-Vorlagen. Alles als Modul abschaltbar (16.1), keine Hotel-Sonderlogik.

### 17.1 Housekeeping (Modul `housekeeping`, braucht `frontdesk`, Standard aus)
- `rooms.clean_status` (`dirty`/`clean`/`inspected`, Standard `clean`) mit Zeitpunkt und Bearbeiter; `housekeeping_tasks` (Zimmer, Tag, Art `checkout`/`stay`/`other`, offen/erledigt; eindeutig pro Zimmer/Tag/Art); `room_issues` (Mängelmeldungen, offen/erledigt).
- Aufträge werden beim Öffnen der Seite für den Tag erzeugt (idempotent): Abreise heute → `checkout` und ein sauberes Zimmer wird «schmutzig»; optional Zwischenreinigung alle N Nächte (`hotels.content.housekeeping.stayEvery`, Standard 0 = aus).
- Handy-Liste `/admin/<hotel>/housekeeping`: grosse Karten je Zimmer (schmutzig zuerst, dann Anreisen), Abreise/Anreise/belegt-Hinweis, Statuswechsel mit einem Tipp, Mangel melden, Extra-Auftrag. Status «sauber»/«geprüft» schliesst offene Aufträge. Keine Preise, keine Gästedaten ausser dem Namen.
- Jede Änderung im `audit_log`; jede Abfrage nach `hotel_id`.

### 17.2 Gäste-Notizen und Tags (Modul `guestnotes`, Standard aus)
- `guest_profiles(hotel_id, email, note, tags[])`, eindeutig pro Betrieb und E-Mail (kleingeschrieben). Notiz höchstens 1000 Zeichen, höchstens 8 Tags zu je 24 Zeichen, Duplikate ohne Beachtung der Gross-/Kleinschreibung entfernt. Leere Notiz und keine Tags löscht den Eintrag.
- Karte «Notiz zum Gast» auf der Buchung (Rolle staff). Seite «Kartei» (`/admin/<hotel>/guestbook`): Gäste mit Anzahl bestätigter Aufenthalte, letzter Anreise, Tags, Notiz; Suche über Name, E-Mail, Tag, Notiz; Filter nach Tag.
- Im `audit_log` steht nur «geändert» mit Anzahl Tags, nie der Inhalt. Formular weist darauf hin, keine heiklen Daten zu notieren.

### 17.3 Statistik (Modul `statistics`, Standard an)
- Seite `/admin/<hotel>/statistics` mit Zeitraum «Dieser Monat / Letzter Monat / Dieses Jahr / Letzte 12 Monate» (wie Übersicht). Kennzahlen: Belegung (verkaufte / verfügbare Zimmernächte), ADR (Zimmerumsatz / verkaufte Nächte), RevPAR (Zimmerumsatz / verfügbare Nächte), Zimmerumsatz; Tabellen nach Monat, Herkunft (Kanal) und Zimmertyp.
- Reine Logik `src/domain/stats.ts` (`computeStats`), Daten aus `booking_rooms.nightly_prices` bestätigter Buchungen (`src/services/statistics.ts`), jede Abfrage nach `hotel_id`.

### 17.4 Rollen pro Modul
- Neue Rollen in `hotel_members.role`: `reception` (Rezeption), `housekeeping` (Reinigung), `accounting` (Buchhaltung). Pure Logik in `src/domain/roles.ts`.
- **Sicher als Standard:** `requireHotel(hotelId, min, area?)`. Eingeschränkte Rollen erfüllen nie eine Mindestrolle, sie kommen nur auf Seiten/Aktionen, die einen Bereich (`area` = Menü-Schlüssel) angeben, der in `ROLE_AREAS` für die Rolle steht, und nur wo «staff» genügt. Alles andere ist 404.
- Bereiche: Rezeption: home, calendar, bookings, frontdesk, plan, housekeeping, guests, guestbook, inquiries, vouchers, invoices. Reinigung: housekeeping. Buchhaltung: invoices, statistics. Das Menü zeigt nur diese Punkte; `home` leitet auf die Startseite der Rolle weiter (`LANDING`).
- Zuweisung unter Einstellungen → Mitglieder (Inhaber). Rollenwechsel im `audit_log` (`member.add`).

### 17.5 Mail-Vorlagen (Modul `mailtexts`, Standard an)
- `hotels.content.mailTexts[mail][sprache] = { subject?, intro?, outro? }` für `booking_confirmed`, `pre_arrival`, `post_stay`, `balance_due`, `invoice_sent`. Betreff höchstens 120, Einleitung und Schluss je 600 Zeichen, reiner Text (beim Versand maskiert). Platzhalter `{name}`, `{hotel}`, `{reference}`.
- `render()` fügt die Einleitung nach der Anrede und den Schluss nach den Absätzen ein; der Betreff ersetzt den Standardbetreff. Alles andere (Beträge, Daten, Links, Bedingungen) bleibt unverändert. Ohne eigene Texte unverändertes Verhalten.
- Seite `/admin/<hotel>/mail-texte` (Manager): Reiter je Mail, Felder je Sprache des Betriebs, Vorschau mit Beispieldaten. Änderungen im `audit_log` (`mail.texts`).

## 18. PMS Stufe C: Schweiz und Vernetzung

Reihenfolge: 18.1 Gruppen, 18.2 Kurtaxe-Quartalsabrechnung, 18.3 bexio/Abacus-Export, 18.4 Stripe Terminal, 18.5 Nuki. Alles als Modul abschaltbar (16.1).

### 18.1 Gruppen (Modul `groups`, Standard aus)
- Tabellen: `groups` (Name, Firma/Rechnungsadresse, Kontakt, Anreise/Abreise, Freigabefrist, Status `active`/`released`/`cancelled`), `group_block_days` (Zimmertyp × Nacht → noch nicht vergebene Blockzimmer), `bookings.group_id`.
- **Block:** reservierte Zimmer werden in `inventory_days.booked` mitgezählt (Verfügbarkeit, Channex, iCal unverändert), mit Outbox-Eintrag und `audit_log` in derselben Transaktion (`src/services/group-blocks.ts`). Erhöhen nur, soweit frei; verringern nur um freie Blockzimmer.
- **Teilnehmer (Rooming-Liste):** Buchung über `createAdminBooking(..., { groupId })`; in derselben Transaktion wird pro Nacht ein Blockzimmer entnommen und danach normal reserviert, der Bestand bleibt gleich. Zeitraum innerhalb der Gruppenzeit. Rooming-Liste als CSV.
- **Freigabe:** manuell oder täglich 04:05 für Blöcke mit Freigabefrist ≤ heute (`releaseDueGroups`); alle freien Blockzimmer gehen zurück in den Verkauf, Status `released`.
- **Rechnung:** Entwürfe von Teilnehmer-Buchungen gehen an die Firma/Kontaktperson der Gruppe. Eine Sammelrechnung ist nicht Teil von 18.1.
- Seiten `/admin/<hotel>/groups` (Liste, Neu) und `.../groups/<id>` (Block, Teilnehmer, Freigabe); Rolle Rezeption hat Zugang (Bereich `groups`).

### 18.2 Kurtaxe-Quartalsabrechnung
- Kurtaxe-Liste (14.5) zusätzlich pro Quartal (`YYYY-Qn`): `touristTaxQuarter` fasst die drei Monatslisten zusammen (Buchung über Monatsgrenzen einmal, Nächte summiert), Monatssummen darunter. Ansicht, CSV und Druck (mit Zeile für Ort/Datum/Unterschrift) unter Gäste → Kurtaxe-Liste, Umschalter Monat/Quartal; nur Manager; Export im `audit_log`.

### 18.3 Buchhaltung-Export (Modul `accountingexport`, braucht `invoicing`, Standard aus)
- Allgemeines Buchungsjournal als CSV (Semikolon, UTF-8 mit BOM): Datum, Beleg, Text, Soll, Haben, Betrag, MWST-Satz, Referenz (`src/domain/accounting-export.ts`). Kein Format eines bestimmten Programms (bexio/Abacus-Format nicht belegt, siehe `QUESTIONS.md`).
- Inhalt: ausgestellte Rechnungen und Gutschriften (Ausstelldatum; Ertrag netto je Konto und MWST-Satz, MWST getrennt, Kurtaxe auf eigenes Konto, Debitoren Soll), Zahlungen (Zahldatum): Stripe (netto nach Rückerstattung) und Zahlungen vor Ort je Zahlart. Negative Beträge: positiv mit vertauschten Konten.
- Kontenzuordnung je Betrieb (`hotels.content.accounting.accounts`), Vorschlag nach Kontenrahmen KMU. Zeitraum Monat, Quartal oder Jahr. Seite `/admin/<hotel>/buchhaltung` (Vorschau, Konten, CSV); Export im `audit_log`; Rolle Buchhaltung hat Zugang (Bereich `accountingexport`).

### 18.3a Abacus-Export (Teil von `accountingexport`)
- Auf der Seite Buchhaltung zweiter Knopf «Für Abacus (FIBU ASCII Buchungen)»: gleiche Buchungen wie das allgemeine Journal (SPEC 18.3), ausgegeben nach der Abacus-Schnittstellenbeschreibung «FIBU – ASCII Buchungen», Version 2012.00, Mapping AbaDefault (`src/domain/abacus-export.ts`, 64 Felder in dokumentierter Reihenfolge). Je Zeile eine Einzelbuchung: Account = Soll, Account2 = Haben, DebitCredit `D`, ISO/ISO2 `CHF`, Belegnummer auf 10 Zeichen gekürzt, Text auf 80. MWST steht wie im Journal als eigene Buchung auf dem MWST-Konto (Steuermethode 0, keine Steuerfelder).
- Konten müssen für Abacus reine Ziffern sein (höchstens 11); sonst Fehlermeldung mit den betroffenen Konten.
- ASSUMPTION: Die Abacus-Dokumentation beschreibt die Felder, nicht die Dateiform (Trennzeichen, Kopfzeile). Wir schreiben Semikolon, UTF-8 mit BOM, Punkt als Dezimaltrenner, Datum JJJJ-MM-TT und eine Kopfzeile mit den Elementnamen; Version `J`. **Mit einer Testdatei im Abacus des Treuhänders prüfen**, bevor Echtdaten eingelesen werden. Infoniqa (früher Sage 50) und bexio sind noch offen, bis das Format belegt ist (QUESTIONS.md).
- Export steht im `audit_log` (Feld `format`).

### 18.4 Kartenterminal (Modul `terminal`, braucht `invoicing`, Standard aus)
- Stripe Terminal servergesteuert (WisePOS E / S700), Direct Charges: alle Aufrufe mit `Stripe-Account` des Hotels. Location und Leser gehören dem verbundenen Konto (`terminal_readers`).
- Ablauf: PaymentIntent (`card_present`, CHF, Plattformgebühr nach Gebührenregel unten) → `process_payment_intent` am Leser → Webhook `terminal.reader.action_succeeded/failed` oder «Status prüfen» → Erfolg am PaymentIntent bei Stripe prüfen → genau eine `onsite_payments`-Zeile (Art Karte, Notiz «Kartenterminal»). Idempotent (`terminal_payments`, Übergang nur aus `pending`).
- Ein Leser verarbeitet eine Zahlung zugleich; Betrag höchstens der offene Betrag; Abbruch über `cancel_action`; Ereignis eines fremden Kontos wird abgelehnt.
- Oberflächen: Menü «Kartenterminal» (Leser registrieren, Verlauf, nur Inhaber/Manager) und Karte «Kartenzahlung am Terminal» in «Rechnung & Kasse» der Buchung.
- **Gebührenregel (Entscheid 10 vom 21.11.2026, ersetzt «Plattformgebühr auf jede Terminal-Zahlung»):** 1,9 % gelten auf alles, was über Pontivo hereinkommt (Direktbuchungen, Online-Bestellungen, Gutscheine), egal wie bezahlt wird; **keine Plattformgebühr auf Verkäufe vor Ort**, die nicht über Pontivo kamen. Am Terminal: `application_fee_amount` = noch nicht erhobener Teil der Gebühr der Buchung (`platform_fee_rappen` minus Gebühren früherer Online- und Terminal-Zahlungen), nur bei `source = 'direct'`, höchstens Betrag − 1 Rappen (`terminalFee`, `terminal_payments.application_fee_rappen`). Portalbuchungen, von Hand erfasste Buchungen und Posten vor Ort (z. B. Minibar) bleiben am Terminal ohne Plattformgebühr. Die Restzahlung online rechnet Terminal-Gebühren mit. Anzahlungen für Tischreservationen bleiben gebührenfrei (Entscheid Betreiber 21.11.2026, SPEC 19.49 C2).

### 18.5 Zutritt mit Nuki (Modul `access`, braucht `frontdesk`, Standard aus)
- Nuki Web API (Swagger 4.26.0), Token je Betrieb (verschlüsselt, `hotels.content.nuki`). Schlösser werden von Nuki geladen (`door_locks`) und einer Eingangstür (alle Gäste) oder einem Zimmer zugeordnet.
- Je bestätigte Buchung ein Keypad-Code (Typ 13) pro Eingangstür und pro zugewiesenem Zimmer (`door_codes`, Code verschlüsselt), gültig von Check-in-Zeit bis Check-out-Zeit des Betriebs. Stündlicher Job: Codes 3 Tage vor Anreise erstellen; bei Storno zurückziehen; nach Abreise löschen. Fehler bleiben sichtbar (Status `error`) und lassen sich per Knopf wiederholen.
- Seite `/admin/<hotel>/zutritt` (Inhaber/Manager: Token, Schlösser, Zuordnung); Karte «Zutritt» auf der Buchung (Code, Status, Gültigkeit, erstellen, zurückziehen). Codes erscheinen nicht in Gäste-Mails und nicht im KI-Prompt.

### 18.6 Anmeldung: Passkey und Authenticator-App
- **Passkey (WebAuthn, `@simplewebauthn`):** Anmeldung ohne E-Mail-Eingabe über «Mit Passkey anmelden» (auffindbare Anmeldedaten, Gerätesperre Pflicht). Verwaltung auf `/admin/konto` («Sicherheit»): hinzufügen, benennen, entfernen. Tabelle `user_passkeys`. Relying Party = Host von `APP_BASE_URL` (Passkeys gelten nur für diese Domain).
- **Authenticator-App (TOTP, RFC 6238, optional, je Benutzer):** Einrichtung mit QR-Code und Bestätigungscode, danach 10 Wiederherstellungscodes (einmalig angezeigt, nur als Hash gespeichert). Geheimnis verschlüsselt (AES-256-GCM, wie 14.7). Ein Code gilt nur einmal (`last_step`), ±1 Schritt Toleranz.
- **Anmeldewege:** Passwort und Passkey sind gleichwertig (SPEC 19.43), der E-Mail-Link bleibt für «Passwort vergessen» und für die erste Einladung. Die Login-Seite zeigt beide (Passkey auch als Autofill-Vorschlag im E-Mail-Feld), im Admin erinnert ein ausblendbarer Hinweis Konten ohne Passkey.
- **2FA-Ablauf:** 2FA gilt als zusätzliche Stufe für jeden Anmeldeweg. E-Mail-Link oder Passkey mit aktiver 2FA → zweite Seite `/admin/login/2fa` (Code oder Wiederherstellungscode), erst danach Sitzung (Zwischenzustand: signiertes Cookie, 5 Minuten, höchstens 5 Versuche je Benutzer). Ausschalten, neue Wiederherstellungscodes nur mit gültigem Code.
- **«Nur Passkey» (freiwillig, `users.email_login_disabled`):** schaltet die Passwort- und die E-Mail-Link-Anmeldung für das Konto ab (kein Link, bereits ausgestellte Links ungültig). Nur mit mindestens 2 Passkeys einschaltbar; solange aktiv, darf die Zahl der Passkeys nicht unter 2 sinken.
- Kein Zwang zu 2FA oder «Nur Passkey» in dieser Version (siehe QUESTIONS).

### 18.7 Plattform-Verwaltung (nur Plattform-Admin)
- Seite `/plattform` (404 für alle anderen): alle Betriebe (Status, Mitglieder, Anzahl Buchungen und Rechnungen) und alle Benutzer (Betriebe, Passkeys, 2FA).
- Aktionen: Betrieb pausieren/online (mit den üblichen Live-Prüfungen), Mitglied hinzufügen/entfernen, Login-Link senden, Sicherheit eines Benutzers zurücksetzen (Passkeys, 2FA, Wiederherstellungscodes, «Nur Passkey» aus; Support-Weg bei verlorenem Gerät), Betrieb endgültig löschen (alle abhängigen Daten über die Fremdschlüssel, Benutzer bleiben), Benutzer endgültig löschen (Betriebe bleiben; Plattform-Admins nie).
- Löschen verlangt das Eintippen von Name bzw. E-Mail. Hinweis bei live oder mit Rechnungen: Rechnungen sind in der Schweiz 10 Jahre aufzubewahren. Protokoll: `audit_log` ohne Betriebsbezug (`hotel.deleted`, `user.deleted`, `user.security_reset`).
- Nicht enthalten: Löschen oder Kündigen bei Stripe und Channex (separat).

### 18.8 Missbrauchsschutz für Registrierung und Login
- **Cloudflare Turnstile** (Siteverify auf dem Server, Token einmalig, Hostname geprüft) auf `/registrieren` und `/admin/login`. Ohne `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` aus. Ist Cloudflare nicht erreichbar, wird nicht durchgelassen (fail-closed). Nicht auf Formularen hinter dem Login und nicht auf Gäste-Formularen auf fremden Domains: die kostenlose Turnstile-Stufe erlaubt höchstens 10 Hostnamen je Widget, Hotel-Domains lassen sich so nicht abdecken.
- **Honeypot und Mindestzeit** (ohne Drittanbieter, `src/lib/form-guard.ts`, Komponente `FormGuard`): verstecktes Feld und signierter Zeitstempel (Registrierung 3 s, Login 1 s, Ablauf nach 2 Stunden). Honeypot: stille «Danke»-Antwort; zu schnell: Meldung «bitte nochmals absenden».
- **Begrenzung in der Datenbank** (`rate_limits`, atomar, `src/lib/rate-limit-db.ts`): Registrierung je IP 5 pro 10 Minuten und je E-Mail 3 pro Stunde, Login-Link je IP 10 pro 10 Minuten und je Adresse 5 pro Stunde, 2FA-Versuche je Benutzer 5 pro 5 Minuten. E-Mail-Adressen stehen nur als Hash in der Tabelle. In Entwicklung und Tests ist die IP-Grenze 20-fach. Beim Login-Link bleibt die Antwort bei Überschreitung gleich («Link ist unterwegs»).
- **E-Mail-Bestätigung:** `users.email_verified_at` wird beim Einlösen eines Anmelde-Links gesetzt. Ein Betrieb darf erst live gehen (`goLiveProblems`), wenn mindestens ein Inhaber bestätigt ist.
- **Wegwerf-Adressen** werden bei der Registrierung abgelehnt (Liste des Pakets `disposable-email-domains`, MIT, plus eigene Ergänzungen).

### 18.9 Texte der Pontivo-Startseite (Plattform-Admin)
Die Texte der Pontivo-Startseite stehen als Standard im Code (`src/domain/pontivo-site.ts`). Der Plattform-Admin überschreibt sie unter `/plattform/website`; Überschreibungen liegen in `platform_settings` (Schlüssel `site_texts`). Platzhalter: `{name}`, `{fee}`, `{emailTo}`. «Zurücksetzen» stellt den Standard wieder her.

### 18.10 Mein Konto (eigene Seite je Benutzer)
Namen: Die Kopfzeile des Admin zeigt «Pontivo · <Betrieb>», die App auf dem Startbildschirm heisst «Pontivo», der Link zur persönlichen Seite «Mein Konto». Seite `/admin/<hotelId>/konto` ersetzt das frühere App-/Sicherheitsfeld im «Mehr»-Menü. Oben: eigene E-Mail-Adresse und Rolle. Bereiche: Webseite-Vorschau, Pontivo-App (Installation, Mitteilungen mit Erklärung), Sicherheit (Passkeys, Authenticator-App, «Nur Passkey»), Weiteres (Abmelden).
E-Mail-Adresse ändern: Link (60 Minuten, einmalig) an die NEUE Adresse, Hinweis an die ALTE; mit aktiver Authenticator-App zusätzlich Code nötig; höchstens 3 Anträge pro Stunde; Wegwerf-Adressen gesperrt; ob die neue Adresse schon vergeben ist, wird nicht verraten. Nach Bestätigung gilt die neue Adresse als verifiziert, offene Login-Links sind ungültig. Tabelle `email_changes`.

### 18.11 Schutz der Gäste-Formulare auf Hotel-Websites
Gilt für Buchung, Anfrage, Gutschein-Kauf und KI-Chat (Chat-Weiterleitung). Kein Konto des Hotels und kein Drittanbieter nötig, funktioniert auf jeder Domain (Turnstile geht dort nicht: höchstens 10 Domains pro Widget, keine Wildcards).
- **Rechenaufgabe (Proof of Work):** `GET /api/pow` liefert eine signierte Aufgabe (Salt, 16 Nullbits, 10 Minuten gültig). Der Browser sucht `nonce` mit SHA-256(salt+nonce) ab 16 Nullbits (ca. 1 Sekunde, unsichtbar) und schickt `<aufgabe>.<nonce>` als `_pow` (Formulare) bzw. `pow` (Buchung, JSON). Jede Aufgabe gilt nur einmal (Tabelle `rate_limits`, Schlüssel `pow:<salt>`). Chat: eine gelöste Aufgabe wird per `POST /api/pow` gegen einen 30-Minuten-Pass getauscht.
- **Zusätzlich:** Honeypot (`website`), Grenzen je IP und je E-Mail-Adresse in der Datenbank (Buchung 30/10 pro Stunde, Anfrage, Gutschein und Chat-Weiterleitung 20/5 pro Stunde), bestehende In-Memory-Grenzen bleiben.
- Ein/Aus: `POW_REQUIRED` (`1` an, `0` aus; Standard: nur in Produktion). Ohne JavaScript lassen sich die geschützten Formulare nicht absenden.

### 18.12 Stripe-Konto vorausfüllen
Beim Eröffnen des verbundenen Kontos gibt Pontivo vorhandene Betriebsangaben mit (`accountPrefill` in `src/integrations/stripe/onboarding.ts`): bei Hotels (Firma) Firmenname, Adresse, Telefon; bei allen die öffentlichen Kontaktangaben (E-Mail, Telefon, Adresse, eigene Domain als Website). Leere Angaben entfallen. Das Stripe-Formular zeigt sie zur Kontrolle; Persönliches (Geburtsdatum, Ausweis, IBAN) füllt Pontivo nie vor. Gilt nur für neu eröffnete Konten.

## 19. PMS Stufe E: Ersetzen (Konzept: `docs/PMS-ERSATZ.md`)

Freigegeben am 15.11.2026. Reihenfolge laut Entscheid: zuerst die fehlenden Funktionen (19.1 ff.), dann Eignungs-Check (PMS-ERSATZ 4.1), dann Restaurant und Kasse (PMS-ERSATZ 5). Migration (PMS-ERSATZ 2) und Einarbeitung (4.2) folgen später. Weitere Zahlungsanbieter sind zurückgestellt (PMS-ERSATZ 9.5). Alle Annahmen in `QUESTIONS.md`.

### 19.1 Tagesabschluss (Teil von Modul `invoicing`)
- Tabelle `day_closes` (Hotel, Tag, Summen als JSON, erwartetes und gezähltes Bargeld, Differenz, Notiz, Benutzer, Zeitpunkt; ein Abschluss pro Tag und Betrieb). Abschlüsse werden nie geändert oder gelöscht.
- Summen: Zahlungen vor Ort je Zahlungsart (Rückzahlungen negativ), Online-Zahlungen (Stripe, nach Rückerstattung, Tag in der Zeitzone des Betriebs), ausgestellte Rechnungen und Gutschriften mit Brutto und MWST je Satz.
- Kassenzählung ist optional; Differenz = gezählt minus erwartet (nur Barzahlungen vor Ort).
- **Sperre:** Auf einen abgeschlossenen Tag lassen sich keine Zahlungen vor Ort buchen und keine Rechnungen oder Gutschriften ausstellen (Datum = Tag des Abschlusses). Korrekturen auf den heutigen Tag (Gegenbuchung, Gutschrift). Frühere offene Tage bleiben buchbar. Zukünftige Tage lassen sich nicht abschliessen.
- Seite `/admin/<hotel>/invoices/tagesabschluss` (Reiter «Tagesabschluss», Menüschlüssel `dayclose`, Rollen `staff` und eingeschränkt `reception`, `accounting`), Druckansicht über den Browser.
- ASSUMPTION: Pro Tag genau ein Abschluss; kein Zwang, frühere Tage zuerst abzuschliessen.

### 19.2 Bewertungen einholen (Modul `feedback`, Standard aus)
- Mit dem Modul bekommt die Nachher-Mail (`post_stay`, wie bisher nur an Gäste mit Einwilligung, 1 Tag nach Abreise) statt «wieder buchen» den Knopf «Aufenthalt bewerten» (Mail-Daten `feedback: true`, beim Einreihen gesetzt). Zeile «Beim nächsten Mal direkt buchen» steht darunter.
- Seite `/b/<token>/feedback` (persönlicher Buchungslink, `noindex`): Note 1 bis 5 und freiwilliger Kommentar; eine Rückmeldung pro Buchung (`stay_feedback`, eindeutig je Buchung). Texte in allen fünf Website-Sprachen (`src/i18n/feedback.ts`).
- Einstellungen (`hotels.content.feedback`): Link zur öffentlichen Bewertungsseite (nur `https`) und Mindestnote (2 bis 5, Standard 4). Ab Mindestnote **und** gesetztem Link zeigt die Danke-Seite den Link, sonst nur den Dank. Unter der Mindestnote geht eine Mail (`feedback_alert`) mit Note und Kommentar ans Haus, der Gast sieht keinen öffentlichen Link.
- Admin: Reiter «Bewertungen» unter «Gäste» (Menüschlüssel `feedback`): Einstellungen (Rolle manager), Liste mit Durchschnitt.
- ASSUMPTION: Gleiche Einwilligung wie die Nachher-Mail. Der Link zur Bewertungsseite wird nur bei guter Note gezeigt (Bewertungsportale verbieten gezieltes Filtern teilweise; Haus prüft die Regeln seines Portals).

### 19.3 Preisempfehlung (Modul `pricing_rules`, Standard aus)
- Je Tarif eine Regel (`pricing_rules`): Basispreis, Mindest- und Höchstpreis (Rappen, ganze Franken), bis zu drei Auslastungsstufen (ab x % Auslastung ± y %), optional Last Minute (innerhalb n Tagen und unter x % Auslastung ± y %), Zu-/Abschlag je Wochentag. Ereignisse (`pricing_events`: Name, Zeitraum, ± %) gelten für alle Tarife des Betriebs.
- Preis = Basispreis × (1 + Summe der Zu-/Abschläge), auf ganze Franken gerundet, auf Minimum/Maximum begrenzt. Immer ab Basispreis, daher wiederholbar. Auslastung = gebucht / (Zimmer − gesperrt − extern gesperrt) des Zimmertyps der Nacht (`src/domain/pricing-rules.ts`).
- Täglich (Job `pricing`, 03:30) und auf Knopfdruck werden Vorschläge für die nächsten 90 Nächte berechnet (`pricing_proposals`, Status offen/übernommen/verworfen) mit einem Satz Begründung. Nächte ohne Preis oder mit Verkaufsstopp werden übersprungen. Verworfene Vorschläge kommen mit gleichem Preis nicht wieder.
- Übernehmen läuft über `updateRatesBatch` (Preis im Kalender, `channex_outbox` und `audit_log` in einer Transaktion). Nichts ändert sich ohne Bestätigung, ausser die Regel hat «automatisch übernehmen»; dann nur innerhalb Minimum/Maximum (wird beim Übernehmen nochmals geprüft).
- Seite `/admin/<hotel>/preise` (Reiter «Preisempfehlung» beim Kalender, Menüschlüssel `pricing`), Änderungen Rolle `manager`.
- Die KI-Preisempfehlung bleibt ein eigenes, kostenpflichtiges Zusatzmodul (`ai_pricing`, später).
- ASSUMPTION: Preise je Tarif und Nacht, keine Berücksichtigung von Personenpreisen oder Mindestaufenthalt; Konkurrenzpreise folgen nicht.

### 19.4 Pauschalen (Verpflegungsart je Tarif)
- `rate_plans.board` (`none`, `breakfast`, `half`, `full`) ersetzt das Frühstück-Häkchen; `breakfast_included` bleibt als abgeleiteter Wert (board ≠ none) für Kanäle und Bestandscode. Bestehende Tarife: mit Frühstück → `breakfast`, sonst `none`.
- Bei Halb-/Vollpension ist `meal_rappen` Pflicht: Wert der Verpflegung je Person und Nacht. Auf der Rechnung wird er (Personen × Nächte × Wert, höchstens der Zimmerbetrag) als Zeile «Verpflegung Halbpension/Vollpension» zum Normalsatz abgespalten; der Rest bleibt Beherbergung zum Sondersatz (inkl. Frühstück). Das Buchungstotal ändert sich nicht (`src/domain/board.ts`).
- Gast sieht «Halbpension/Vollpension inbegriffen» in allen fünf Sprachen. Admin: Auswahl «Verpflegung» im Tarif.
- ASSUMPTION: Kinder zählen als Personen für den Verpflegungswert; Channex bekommt weiter nur «Frühstück ja/nein» (kein neues API-Feld erfunden).

### 19.5 Zimmerwechsel (Teil von Modul `frontdesk`)
- Tabelle `room_moves` (Buchungszimmer, altes und neues Zimmer, Wechseltag, Grund, Benutzer). `booking_rooms.room_id` bleibt das aktuelle Zimmer; die View `room_stays` liefert die Belegung je Zimmer und Zeitraum (Nächte [von, bis)) inklusive Wechsel.
- Wechsel nur bei bestätigter Buchung mit zugewiesenem Zimmer, Wechseltag zwischen Anreise (ausgeschlossen) und Abreise (ausgeschlossen), nach dem letzten Wechsel, in ein aktives Zimmer **desselben Zimmertyps**, das ab dem Wechseltag frei ist. Mehrere Wechsel sind möglich; danach ist `assignRoom` für diese Buchung gesperrt.
- Wirkung: Doppelbelegungsprüfung, Auto-Zuweisung, Zimmerplan (zwei oder mehr Abschnitte) und Reinigung (Abreise aus dem alten Zimmer am Wechseltag, dort «schmutzig») folgen `room_stays`. Verfügbarkeit nach Zimmertyp, Channex und Preise ändern sich nicht. Audit `room.move`.
- Admin: Zimmerplan → «Zugewiesenes Zimmer ändern» → «Zimmer wechseln».
- ASSUMPTION: Kein Wechsel in einen anderen Zimmertyp (Up-/Downgrade mit Preisfolge folgt bei Bedarf; bis dahin Differenz als Posten auf die Rechnung). Zutrittscodes (Nuki) und die Tagesliste zeigen das aktuelle Zimmer.

### 19.6 Mehrzimmerbuchung
- Eine Buchung kann mehrere Zimmer haben (`booking_rooms`, je Zimmer eigener Tarif, eigene Belegung und eigene Nachtpreise). Höchstens 6 Zimmer.
- **Online:** Suchfeld «Zimmer» (1 bis 4). Erwachsene und Kinder sind Summen und werden gleichmässig auf gleiche Zimmer verteilt (jedes Zimmer mindestens ein Erwachsener, Kinder reihum samt Alter; `src/domain/multiroom.ts`). Ein Angebot erscheint nur, wenn die Personen in jedes Zimmer passen und genug Zimmer frei sind. Preis = Summe der Einzelzimmer-Preise; Kurtaxe summiert nach den Personen je Zimmer.
- **Rezeption:** «Buchung erfassen» mit bis zu zwei weiteren Zimmern mit eigenem Typ, Tarif und eigener Belegung (gemischte Zimmer). Gruppenbuchungen (Block) bleiben ein Zimmer.
- Verfügbarkeit: je Zimmer ein Platz in `inventory_days`, alle atomar in einer Transaktion; reicht es für eines nicht, wird nichts belegt (409). Freigabe bei Ablauf des Holds, Storno und Verschiebung läuft über alle Zimmer; Channex-Outbox je betroffenem Zimmertyp.
- Zusatzleistungen: gewählte gelten für die ganze Buchung (alle Personen), obligatorische je Zimmer.
- Rechnung: eine Übernachtungszeile je Zimmer. Admin-Detail, Gästeseite und Mails nennen alle Zimmer («2 × Doppelzimmer, Einzelzimmer»).
- ASSUMPTION: Die Stornoregel des ersten Zimmers gilt für die ganze Buchung. Ein Gast kann online nur gleiche Zimmer buchen; gemischte Zimmer erfasst die Rezeption. Keine Teilstornierung einzelner Zimmer (Stornieren oder Ändern geht für die ganze Buchung).

### 19.7 Debitoren (Modul `debtors`, Standard aus, braucht `invoicing`)
- **Firmenkunden** (`companies`: Name, Adresse, MWST-Nr., E-Mail für Rechnungen, eigene Zahlungsfrist, aktiv). Eine Buchung wird in der Buchung einer Firma zugeordnet (`bookings.company_id`), solange keine gültige Rechnung ausgestellt ist. Die Rechnung (`invoices.company_id`) geht dann an die Firma; Fälligkeit = Ausstellung + Firmenfrist, sonst Standardfrist der Rechnungseinstellungen.
- **Offene Rechnungen:** ausgestellte, nicht gutgeschriebene Rechnungen mit Restbetrag > 0 (Rechnungstotal minus Online- und Vor-Ort-Zahlungen der Buchung, wie in der Rechnungsansicht). Alterung: nicht fällig, 1–30, 31–60, über 60 Tage. Seite `/admin/<hotel>/invoices/debitoren` (Reiter «Debitoren», Menüschlüssel `debtors`, Rolle `staff` und eingeschränkt `accounting`).
- **Zahlungseingang:** Teil- oder Ganzzahlung zur Rechnung wird als Zahlung vor Ort mit Art «Überweisung» auf die Buchung gebucht (gleiche Regeln: Tagesabschluss-Sperre; liegt das Valuta in einem abgeschlossenen Tag, gilt heute und das Valuta steht in der Notiz).
- **Bankdatei camt.054** (ISO 20022): Gutschriften (CRDT) mit Betrag, Buchungsdatum und QR-Referenz (`CdtrRefInf/Ref`) werden über die Referenz der Rechnungsnummer (`qrReference`) zugeordnet und verbucht. Jeder Eintrag nur einmal (`bank_entries`, eindeutig je Bankreferenz). Nicht zuordenbare Einträge werden gemeldet und nicht gespeichert (ein späterer Import versucht es erneut).
- **Mahnwesen:** Stufen Zahlungserinnerung (ab 5 Tagen nach Fälligkeit), 1. Mahnung (ab 20), 2. Mahnung (ab 35). Nur der Reihe nach, nur auf Knopfdruck, nur wenn offen. Mail `dunning` in fünf Sprachen mit Link zur Rechnung an die Adresse der Rechnung (sonst des Gastes); je Stufe ein Eintrag in `invoice_dunnings`, Audit `invoice.dunning`.
- ASSUMPTION: Keine Mahngebühren und keine automatische Mahnung (Haus entscheidet je Fall). Fristen der Stufen fest. camt.054-Felder nach ISO-20022-Standard (nicht gegen eine Bankdatei geprüft; mit der ersten echten Datei testen). Keine Mehrfachzahlung über mehrere Rechnungen; keine Sammelrechnung mehrerer Buchungen (QUESTIONS.md).

### 19.8 HESTA-Auswertung (Teil von Modul `statistics`)
- Seite `/admin/<hotel>/statistics/hesta` (Reiter «HESTA» bei der Statistik, Menüschlüssel `hesta`, Rolle `staff` und `accounting`) mit Monatsauswahl (Standard: Vormonat) und CSV (`.../hesta/csv?month=JJJJ-MM`, Audit `hesta.export`).
- Inhalt: Zimmer, Betten (Summe der Höchstbelegung je Zimmertyp), verfügbare und belegte Zimmernächte, Zimmerauslastung; Ankünfte (Anreise im Monat) und Logiernächte (Nächte im Monat, auch über den Monatswechsel) je Herkunftsland (`src/domain/hesta.ts`, `src/services/hesta.ts`).
- Herkunftsland = Nationalität aus der Gästemeldung (`guest_registrations`); Personen ohne Meldung (Erwachsene + Kinder der Buchung minus gemeldete) stehen unter «Land unbekannt». Nur bestätigte Buchungen.
- Keine Übermittlung an das BFS: Die Zahlen werden im BFS-Portal (eHESTA) erfasst. Eine technische Schnittstelle ist nicht öffentlich dokumentiert; es wurde nichts erfunden (QUESTIONS.md).
- ASSUMPTION: Betten = Höchstbelegung der Zimmertypen (Zusatzbetten, gesperrte Zimmer und Saisonbetrieb nicht berücksichtigt); die genauen Variablen und Gliederung (z. B. Herkunft nach BFS-Ländergruppen) liefert das BFS in der Wegleitung.

### 19.9 Posteingang (Modul `inbox`, Standard aus, braucht `channex`)
- Gästenachrichten von Booking.com, Airbnb und Expedia über die Channex-App «Messages» (Doku: docs.channex.io, Messages Collection; die App muss an der Property installiert sein und kostet bei Channex extra). Seite `/admin/<hotel>/inbox` (Reiter «Posteingang» unter Gäste, Menüschlüssel `inbox`, Rolle `staff` und `reception`).
- **Eingang:** Webhook `/api/webhooks/channex/messages` (Ereignisse `message`, `message_thread_booking_assigned`, signiert wie SPEC 7.3, `send_data=true`; `scripts/channex-webhook.ts` legt ihn an). Betrieb über `property_id` ↔ `hotels.channex_property_id`; unbekannte Betriebe werden ignoriert. Speicherung idempotent je (Thread, Nachrichten-Id). Buchungszuordnung über `bookings.channex_booking_id`.
- **Mitteilung** (Push) bei jeder Gästenachricht ohne Namen und Text (nur Portal). Ungelesen-Zähler je Unterhaltung; Öffnen setzt auf gelesen.
- **Antworten und Abschliessen** über die Channex-API (`POST /message_threads/{id}/messages`, `/close`); Fehler werden angezeigt, nichts wird lokal als gesendet gespeichert. Audit `inbox.reply`, `inbox.close`. Eine neue Gästenachricht öffnet eine abgeschlossene Unterhaltung wieder.
- ASSUMPTION: Webhook-Feldnamen (`payload.message_thread_id`, `payload.id`, `payload.message`, `payload.sender`) nach Channex-Doku, nicht gegen Staging geprüft; Absender «guest» = Gast, alles andere = Hotel. Anhänge werden nur gezählt, nicht angezeigt. Kein Nachladen des Verlaufs vor der Aktivierung, keine Übersetzung, keine Vorlagen.

### 19.10 Eigentümerabrechnung (Modul `owners`, Standard aus, braucht `invoicing`)
- Für Verwalter von Ferienwohnungen. **Eigentümer** (`owners`: Name, E-Mail, Kommission des Hauses in Prozent, Objekte = Zimmertypen, aktiv). Ein Objekt gehört höchstens einem aktiven Eigentümer. Seite `/admin/<hotel>/owners` (Reiter «Eigentümer» bei den Rechnungen, Menüschlüssel `owners`, Rolle `staff` zum Ansehen, `manager` zum Ändern, eingeschränkt `accounting`).
- **Abrechnung je Monat** (`src/domain/owners.ts`, `src/services/owners.ts`): Umsatz = Übernachtungspreise (`booking_rooms.nightly_prices`) bestätigter Buchungen für die Objekte des Eigentümers, Nächte im Monat. Kommission = Umsatz × Satz (gerundet auf Rappen). Kosten = manuell erfasste Posten (`owner_costs`, Beschreibung, Betrag). Auszahlung = Umsatz − Kommission − Kosten (kann negativ sein).
- **Ausgabe:** Druckansicht `/admin/<hotel>/owners/<eigentümer>/<JJJJ-MM>` (Browser «Drucken» → PDF) und Mail `owner_statement` an die Adresse des Eigentümers, je Monat einmal; der versendete Stand wird gespeichert (`owner_statements`). Audit `owner.*`.
- ASSUMPTION: Umsatz ohne Kurtaxe, Zusatzleistungen und MWST-Ausweis; Stornierte Buchungen zählen nicht; kein Eigentümer-Login (Lesezugang für Eigentümer) und kein automatischer Monatsversand in V1, kein PDF-Anhang (QUESTIONS.md).

### 19.11 Angebote vor Ort (Modul `resources`, Standard aus, braucht `invoicing`)
- Buchbare Ressourcen wie Wellness, Sauna, Seminarraum, Tennisplatz. **Angebot** (`resources`: Name, Art, Plätze je Zeitfenster, Länge des Zeitfensters 15 bis 480 Minuten, Öffnungszeit, Preis je Zeitfenster, Preis pro Person ja/nein, MWST-Art, aktiv). Seite `/admin/<hotel>/resources` (Reiter «Angebote vor Ort» bei den Buchungen, Menüschlüssel `resources`, Rolle `reception` zum Buchen, `manager` zum Einrichten).
- **Buchung** (`resource_bookings`): Tag, Von/Bis im Raster der Zeitfenster innerhalb der Öffnungszeit, Personen. Freie Plätze = Plätze minus höchste gleichzeitige Belegung; die Ressource wird in der Transaktion gesperrt, damit nichts überbucht wird. Seminarräume (`kind = seminar`) sind exklusiv: eine Buchung belegt den ganzen Raum.
- **Posten aufs Zimmer:** Mit der Buchungsnummer eines bestätigten Hausgasts wird der Preis als Posten (`folio_items`) gebucht und erscheint auf der Rechnung. Stornieren löscht den Posten, solange er nicht auf einer Rechnung steht (sonst Gutschrift). Ohne Buchungsnummer (Tagesgast) wird nur die Reservation gespeichert; die Zahlung läuft über die Kasse.
- ASSUMPTION: Nur Rezeption und Admin buchen (keine Online-Buchung durch Gäste, kein Wartelisten- oder Wiederholungs-Mechanismus; Seminarangebot als PDF: siehe 19.21); Preis je Zeitfenster gilt für alle Tage gleich (QUESTIONS.md).

### 19.12 Newsletter (Modul `marketing`, Standard aus)
- Mail an Gäste, die bei der Buchung dem Newsletter zugestimmt haben (`guests.marketing_consent`). Seite `/admin/<hotel>/marketing` (Reiter «Newsletter» bei den Gästen, Menüschlüssel `marketing`, Rolle `manager`).
- **Auswahl** (`src/domain/newsletter.ts`): Sprache, Stichwort aus der Gästekartei, Aufenthalt (Abreise ab Datum), Mindestzahl Aufenthalte; alle Bedingungen gelten gemeinsam. Eine Adresse zählt einmal je Betrieb (Gross-/Kleinschreibung egal).
- **Entwurf → Testmail → Versand** (`newsletters`, Status `draft|sent`). Der Versand läuft über die E-Mail-Outbox (`newsletter`), Empfänger zum Zeitpunkt des Versands, nur einmal (Statuswechsel atomar). Audit `newsletter.*`.
- **Abmeldung** (DSG/UWG): jede Mail hat einen Abmeldelink `/abmelden?h&e&t` mit HMAC über Betrieb und E-Mail (`AUTH_SECRET`). Der Link zeigt nur einen Knopf, erst der Klick widerruft die Einwilligung für alle Gästeeinträge dieser E-Mail im Betrieb.
- ASSUMPTION: Der Abmeldelink steht als Knopf am Ende, kein `List-Unsubscribe`-Header; keine Statistik (Öffnungen, Klicks), keine geplante Versandzeit, kein Bild-/HTML-Editor (nur Text mit Absätzen); Einwilligung wird beim Buchen erfasst, ein nachträgliches Anmelden gibt es nicht. Absender ist die Standard-Absenderadresse (QUESTIONS.md).

### 19.13 Gästeportal ausbauen (Seite `/b/<token>`, kein eigenes Modul)
- Die Buchungsseite des Gastes bekommt (statt einer App): **Infos zum Aufenthalt** (`hotels.content.guestInfo`, je Sprache, im Einrichtungs-Assistenten beim Schritt «Infos zur Ankunft»; sichtbar für bestätigte Buchungen, im Unterschied zu den Ankunftsinfos mit Codes nicht auf den Aufenthalt begrenzt), einen Hinweis **Extras dazubuchen** mit Link zur Extras-Seite (nur wenn Upselling aktiv ist und Extras vorhanden sind) und **Zum Kalender hinzufügen** (`/b/<token>/kalender`, .ics, ganztägig Anreise bis Abreise).
- Bestehend und unverändert: Ankunftsinfos während des Aufenthalts, Online-Check-in, Restzahlung, Stornierung, Chat.
- ASSUMPTION: Hausinfos sind eine Freitext-Spalte je Sprache (keine Bausteine, keine Bilder); keine eigene App und keine Push-Mitteilungen an Gäste; Zugangscodes gehören weiter nur in die Ankunftsinfos.

### 19.14 Eignungs-Check (Seite `/eignung`, kein Modul)
- Öffentliche Seite mit drei Fragen (Zimmerzahl, Restaurant mit eigener Kasse, bisherige Software) und einer von drei Antworten: **Passt**, **Passt mit Kassen-Schnittstelle oder Kassenmodul**, **Läuft daneben** (`src/domain/suitability.ts`). Verlinkt von `/registrieren`. Es wird nichts gespeichert (GET-Formular).
- Regeln: mehr als 40 Zimmer oder eine Software für grosse Häuser → «ergänzt Ihre Software» (Direktbuchung und Kanäle trotzdem nutzbar); Restaurant mit eigener Kasse → «mit Kassen-Schnittstelle oder Kassenmodul»; sonst «passt».
- Die Antwort verspricht nur Vorhandenes: Kassenschnittstelle, Kassenmodul und geführte Datenübernahme werden als «in Entwicklung/Vorbereitung» benannt. ASSUMPTION: Schwelle 40 Zimmer aus PMS-ERSATZ (Zielgruppe); sobald diese Funktionen gebaut sind, die Texte anpassen.

### 19.15 Kassen-Schnittstelle PosBridge (Modul `posbridge`, Standard aus, braucht `invoicing`)
- Wer seine Restaurantkasse behält, bucht Posten aufs Zimmer: `POST /api/v1/folio-items` (JSON) mit Header `Authorization: Bearer pnt_…`. Felder: `room_number` **oder** `booking_reference`, `description`, `quantity` (Standard 1, nicht 0), `unit_price_rappen` (ganze Rappen, negativ = Gutschrift), `vat` (`standard`|`stay`|`none`, Standard `standard`), `external_id` (Beleg-ID der Kasse). Der Posten erscheint als `folio_items` in der Hotelrechnung (SPEC 16.3).
- **Schlüssel** je Betrieb (`api_keys`), Seite `/admin/<hotel>/posbridge` (Reiter «Kassen-Schnittstelle» unter «Verbinden», Rolle `owner`). Klartext nur einmal bei der Erstellung sichtbar, gespeichert wird nur der SHA-256-Hash; widerrufbar; «zuletzt benutzt». Das Hotel kommt immer aus dem Schlüssel, nie aus der Anfrage. Höchstens 120 Anfragen pro Minute und Schlüssel (429).
- **Zimmernummer:** Gast im Haus (Anreise bis vor Abreise, berücksichtigt Zimmerwechsel über `room_stays`); gibt es keinen, der am Abreisetag. Mehrere Treffer → 409 `ambiguous` (dann `booking_reference` senden), keiner → 404. Nur bestätigte Buchungen.
- **Idempotent** über `external_id` (eindeutig je Betrieb): gleiche Anfrage → 200 mit `duplicate: true`, nichts doppelt; gleiche ID mit anderem Inhalt oder anderer Buchung → 409 `conflict`. Neu → 201. Audit `folio.add` mit Akteur `api:<Schlüssel>`.
- ASSUMPTION: Posten auf einer schon ausgestellten Rechnung erscheinen erst in einer neuen Rechnung bzw. nach Gutschrift und Neuausstellung (wie von Hand erfasste Posten); keine Webhooks zurück an die Kasse, kein Abruf des Zimmerstands und keine Stornierung über die API (Gutschrift = negativer Posten mit neuer `external_id`). Welche Kassen zuerst angebunden werden, ist offen (QUESTIONS.md).

### 19.16 Restaurant und Kasse (Modul `pos`, Standard aus, braucht `invoicing`)
Grundlage: `docs/PMS-ERSATZ.md` 5.3 (Treuhänder-/Kassenvorgaben). Diese Stufe: Datenmodell und Dienst (`src/services/pos.ts`, `src/domain/pos.ts`, Migration `0053_pos.sql`). Oberfläche und Offline-Betrieb folgen.
- **Stamm:** `pos_items` (Preis in Rappen, MWST-Satz vor Ort und ausser Haus, Tagesangebot), `pos_tables`, `pos_devices` (Kürzel `^[A-Z0-9]{1,6}$`, z. B. `T1`).
- **Bestellung:** `pos_orders` (Client-UUID, idempotent), `pos_order_lines` (append-only). Satz je Zeile aus dem Artikel und der Art (`dine_in`/`takeaway`); nicht MWST-pflichtige Betriebe: 0. Rabatt nur mit Grund. Ungezahlte Zeilen werden mit Grund durch Gegenzeile storniert, bezahlte nur per Gegenbon.
- **Bezahlen:** `pay()` bucht eine Auswahl von Zeilen (Teilmengen, Getrennt-Zahlen) mit Zahlarten `cash|card|twint|room` (Summe = Bonbetrag, Trinkgeld getrennt). «aufs Zimmer» ist nur als einzige Zahlart möglich und bucht `folio_items` mit eigenem MWST-Satz (`vat_bps_override`), Trinkgeld ohne MWST. Wiederholung mit derselben `receiptId` ändert nichts.
- **Bons (`pos_receipts`):** unveränderbar (Trigger verbietet UPDATE/DELETE auch auf Zeilen, Zahlungen, Tagesabschlüssen). Nummer `T1-000042` je Gerät lückenlos (`UNIQUE(device_id, bon_no)`), Lücken werden geprüft. Hash-Kette über alle Bons des Betriebs (`seq`, `prev_hash`, `hash` = SHA-256 über feste, schlüsselsortierte Felder); `verifyHotel()` meldet den ersten fehlerhaften Bon.
- **Gegenbon** (`reverseReceipt`, Manager, mit Grund): neuer Bon mit negativen Beträgen; Zimmerbuchungen werden negativ gegengebucht; gesperrt, sobald die Posten auf einer Rechnung stehen.
- **Tagesabschluss:** `closeDay` mit gezähltem Bargeld; Z-Bericht (Summen je Zahlart und MWST-Satz, erwartetes Bargeld, Differenz) unveränderbar; ein Tag nur einmal. Bons mit geschlossenem Geschäftstag zählen am nächsten offenen Tag (`late`). Gerätezeit nur, wenn plausibel (höchstens 60 s in der Zukunft, jünger als 7 Tage). Export CSV je Zeitraum.
- ASSUMPTION: Karte/TWINT ist in V1 vom Personal bestätigt (keine Terminal-Anbindung); Barverkäufe sind nicht Teil von `onsite_payments`. Offene Punkte für den Treuhänder: Nummernkreis je Gerät, MWST-Sätze je Posten, Art. 70 MWSTG, kantonale Vorgaben.

- **Oberfläche (Stufe C):** Menüpunkt «Restaurant» (Reiter Tische, Artikel, Kassenabschluss) unter «Heute» (SPEC 19.42). Tische mit offenen Bestellungen, Bestellung (Artikel, Menge, im Haus/Take-away), Bezahlen mit Mengenwahl je Zeile (Getrennt-Zahlen), Zahlart, Trinkgeld, Buchungsnummer für «aufs Zimmer». Rabatt, Storno, Gegenbon, Artikelstamm, Tische, Geräte, Kassenabschluss und CSV-Export nur Rolle `manager` oder höher; Seiten `/admin/<hotel>/restaurant/...`. Die Weboberfläche bucht über das Gerät `W1`.
- **Rolle `service`** (Migration 0054): sieht nur den Bereich `restaurant` (bestellen und kassieren), landet dort nach der Anmeldung; in den Einstellungen wählbar.

- **Offline-Betrieb (Stufe D):** Seite `/admin/<hotel>/kasse` (Reiter «Kasse (offline-fähig)», Rollen `staff`/`service`). Lokal zuerst: Bestellungen, Zeilen und Bons werden im Browser (IndexedDB) festgehalten und danach über `POST /api/pos/sync` übertragen; Artikel, Tische, Gäste im Haus und offene Bestellungen holt `POST /api/pos/bootstrap` (Sitzung per Cookie, nur `application/json`, Antworten 401/403/404/409 statt Weiterleitung). Der Service Worker (`/admin/sw.js`) hält die Kassenseite und die Programmdateien vor, damit sie ohne Verbindung startet (nur im Produktivbetrieb); Daten liegen nie im Service-Worker-Speicher.
- **Nummernkreis je Gerät:** Ein Gerätecode gehört genau einem Browser (`claimed_key`); ein zweiter Browser bekommt 409, ein Manager kann das Gerät freigeben. Das Gerät vergibt Bon-Nummern selbst (zuerst gespeichert, dann gebucht) und führt sie nach dem Stand des Servers weiter. Alle Ids (Bestellung, Zeile, Bon) vergibt das Gerät als UUID: eine Wiederholung nach abgebrochener Verbindung bucht nichts doppelt.
- **Preise wie dem Gast gezeigt:** Offline-Zeilen übernehmen Text, Preis und MWST-Satz vom Gerät (`snapshot`), der Artikel muss im Betrieb existieren. **Aufs Zimmer** offline: Auswahl aus der zwischengespeicherten Gästeliste; der Server prüft die Buchung beim Übertragen. Ist sie nicht mehr zu finden, bleibt der Bon bestehen (der Gast hat bezahlt), ohne Zuordnung, und erscheint im Kassenabschluss als Warnung (von Hand in der Hotelrechnung erfassen).
- **Abgelehnte Vorgänge** (z. B. Zeile von einem anderen Gerät schon bezahlt) werden einzeln abgelehnt und halten die übrigen nicht auf. Eine abgelehnte Zahlung hinterlässt eine Lücke in den Bon-Nummern; der Grund steht im Protokoll (`pos.sync_rejected`) und im Kassenabschluss. Der Kassenabschluss warnt ausserdem bei Geräten mit nicht übertragenen Vorgängen.
- ASSUMPTION: Karte/TWINT offline sind vom Personal bestätigt (keine Terminal-Anbindung). Rabatt, Storno und Gegenbon gehen nur online (Manager-Seiten). Eine Bestellung hat keinen festen Besitzer: zwei Geräte können dieselbe bezahlen, das zweite wird abgelehnt.

### 19.17 Einarbeitung (PMS-ERSATZ 4.2)
- **Erste Woche** (`/admin/<hotel>/erste-woche`, Menü «Konto», alle Rollen): Checkliste je Rolle (Inhaber/Manager/Mitarbeitende 8, Rezeption 7, Reinigung 4, Buchhaltung 6, Service 5 Aufgaben) mit Link zur Seite. Aufgaben ausgeschalteter Funktionen entfallen. Erledigt-Stand je Person und Betrieb in `onboarding_tasks` (Migration 0056); abhaken nur für Aufgaben der eigenen Liste. Inhalt in `src/domain/guide.ts`.
- **Hilfe** (`/admin/<hotel>/hilfe`): je eingeschaltete Funktion Beschreibung (aus dem Modul-Register), ein Satz «So fangen Sie an» und Link zur Seite. Kein Bild (offen, siehe `QUESTIONS.md`).
- **Einrichtungshilfe:** nur ein Hinweis auf der Hilfeseite (freiwillig, nach Aufwand, Preis vorab). ASSUMPTION: Kontakt ist die Absenderadresse der Mails (`EMAIL_FROM`), bis der Betreiber eine Support-Adresse und Preise festlegt.

## 15. Offene Fragen (nicht raten, in `QUESTIONS.md` führen)

- Channex Produktions-URL und Preise für Staging/Produktion.
- Kurtaxe: Zeilen mit `status='needs_confirmation'` in `tourist_tax_rules` (Wildhaus-Alt St. Johann, Speicher, Hundwil) und AI-Satz (2.50 laut Verordnung, 2.70 laut Drittquelle). Neue Gemeinden beim Onboarding eines Hotels erfassen.
- AVS-Schnittstelle (Format, Zugang, Kosten) für Meldeschein, Kurtaxe und HESTA.
- Gästemeldung Appenzell Innerrhoden.
- Ob Hotels mit eigenem Channel-Manager (z. B. Hotel-Spider) statt Channex angebunden werden (eigene Integration, nicht v1).
- Rechtstexte (AGB Gäste, Vertrag Hotel, Datenschutzerklärung) liefert der Betreiber.

### 19.18 Menü und Einrichtung im Admin
- Das Menü hängt nur von Betriebstyp, eingeschalteten Funktionen und Rolle ab, nie vom Stand der Einrichtung. Es gibt keinen Menüpunkt «Einrichten».
- Stand der Einrichtung: Chip in der Kopfzeile («Einrichtung X von Y»), Einrichtungskarte auf der Übersicht, einzeilige Hinweiszeile auf jeder Seite (nur Inhaber und Geschäftsführung, nicht im Assistenten). Pausierter Betrieb: Hinweis «Gäste können nicht buchen» mit Link zu den Einstellungen.
- Seiten, die Zimmer (Kalender, Preisempfehlung, Zimmerplan, Heute, Reinigung, Statistik, Vertrieb) oder Betriebsangaben (Rechnungen) brauchen, zeigen bis dahin einen Hinweis mit Link zum passenden Schritt. Nichts wird gesperrt.
- «Mein Konto» erreicht man über das Profilbild (Initialen) oben rechts.
- Funktionen: Startprofil wird bei der Registrierung als feste Einträge gespeichert (Ferienwohnung ohne Rezeption). Wizard-Schritt «Was brauchen Sie?» direkt nach den Angaben (Fachbegriffe wie Eigentümerabrechnung und Gruppen haben eine Erklärzeile, `Choice.hint`); Einschalten zieht Voraussetzungen automatisch mit. Abnahme: tests/unit/setup-concept.test.ts, tests/integration/onboarding.test.ts, tests/e2e/onboarding.spec.ts.

### 19.19 Datenübernahme (PMS-ERSATZ E1)
Seite «Datenübernahme» (Einstellungen, Konto-Gruppe; Inhaber und Geschäftsführung). Migration 0057: `import_jobs`, `bookings.source_ref` (eindeutig je Hotel), `bookings.import_job_id`, `guests.import_job_id`, Herkunft `import`.
- **Generisches CSV** (Vorlage zum Download, `src/domain/import-csv.ts`): Reservierungen mit Gast, Zimmertyp- und Tarifname, Gesamtpreis, bezahltem Betrag, Status. Trennzeichen `;` oder `,`, Daten `JJJJ-MM-TT` oder `TT.MM.JJJJ`.
- **Trockenlauf = derselbe Code wie der Import**, am Ende zurückgerollt. Prüfbericht: Fehler, Hinweise, Dubletten (`source_ref` schon vorhanden → übersprungen), Überbuchung (Fehler mit Nummer und Zeitraum), Stichprobe von 10 Reservierungen. Import nur ohne Fehler, alles oder nichts.
- Laufende und künftige Reservierungen belegen das Inventar über `reserveNights` und schreiben `channex_outbox` und `audit_log` in derselben Transaktion; vergangene und stornierte nur als Historie. Keine Gäste-Mails, keine Kartenzahlung, keine Marketing-Einwilligung. «Bezahlt» wird als Zahlung vor Ort (Akteur `import:<Auftrag>`) vermerkt. Der Preis wird unverändert übernommen (keine Neuberechnung).
- **Rückgängig**: Buchungen des Auftrags ohne spätere Zahlung, Posten oder Rechnung werden gelöscht, Nächte frei, Gäste des Auftrags ohne weitere Buchung entfernt; der Rest wird gemeldet und bleibt. Die hochgeladene Datei wird nach Import oder Rückgängig gelöscht.
- **Rechnungsnummern-Start**: «Nächste Nummer» je Jahr, nie rückwärts, lückenlos weiter.
- **Gesamtexport** (nur Inhaber): ZIP mit `reservierungen.csv` (Import-Schema), Gäste, Zimmertypen, Tarife, Rechnungen, Gutscheine; nur des eigenen Betriebs.
- **Gäste und Gutscheine** (Migration 0058, gleiche Seite, Art der Datei aus der Kopfzeile): Gäste mit den Spalten von `gaeste.csv` (Dubletten nach E-Mail, sonst Name; Marketing-Einwilligung nur mit «ja» und Datum, sonst `false`), Gutscheine mit Restwert wie `gutscheine.csv` plus `gueltig_bis` (Code in Pontivo einmalig; Rückgängig nur ohne Einlösung).
- **Assistent**: Pflichtschritt «Bisherige Software» (Ja/Nein, Standard Nein) nach «Was brauchen Sie?». «Ja» oder ein ausgeführter Import schaltet den **Parallelbetrieb** ein (`onboarding.previousSoftware`): Banner auf jeder Seite für Inhaber und Geschäftsführung mit Link zur Checkliste, bis das Umschalten bestätigt ist.
- **Umschalt-Checkliste** (`/migration/umschalten`, `src/domain/switchover.ts`): Zimmer/Preise/Tarife, künftige Reservierungen (Zähler Alt gegen Neu), Kanäle, Zahlungskonto mit Testzahlung, Rechnungsnummern, Team, alter Zugang (freiwillig). Pontivo prüft, was es prüfen kann, der Rest wird bestätigt. «Umschalten» erst wenn alle Pflichtpunkte erledigt sind; danach 30 Tage Rückweg (Import rückgängig, solange nichts Wesentliches daran bearbeitet wurde).
- ASSUMPTION: Reservierungen höchstens 2000 Zeilen je Datei, direkt verarbeitet (kein Hintergrundjob, kein Excel); Zimmertyp und Tarif werden über den Namen zugeordnet (keine Zuordnungsmaske); ein zweiter Import derselben Nummer überspringt statt zu aktualisieren; Rechnungs-PDFs und Meldescheine fehlen im Export; offene Rechnungen werden nicht übernommen (Rechnungen stellt die alte Software fertig, die Nummernreihe läuft weiter); keine Quellprofile einzelner Anbieter, weil dafür echte Beispielexporte nötig sind (Regel: keine erfundenen Formate). Der Rückweg von 30 Tagen wird angezeigt, aber nicht technisch erzwungen.
- Abnahme: `tests/integration/migration.test.ts` (Kriterien 1 bis 9 aus PMS-ERSATZ 2.10), `tests/unit/import-csv.test.ts`, `tests/unit/switchover.test.ts`, `tests/e2e/migration.spec.ts`.

### 19.20 KI-Preisempfehlung (Teil des Tarifs «KI-Zusatz», braucht `pricing_rules`)
Zusatz zur regelbasierten Preisempfehlung (SPEC 19.3). Migration 0059: `pricing_proposals.source` (`rules|ai`), `ai_pricing_runs` (nur Zähler und Token, keine Texte).
- **Ablauf**: pro aktiver Regel ein Aufruf des Modells (`PRICING_MODEL`, Standard `claude-sonnet-5-5`) mit den nächsten 90 Nächten: Auslastung, Buchungen der letzten 7 Tage für die Nacht (Pickup), Vorjahres-Auslastung (gleiche Nacht minus 364 Tage, falls vorhanden), Wochentag, Vorlauf, Ereignisse, aktueller Preis, Preis nach Regeln, Preiskorridor. Keine Gästedaten, keine Konkurrenz- oder Marktpreise (keine erfundene Quelle).
- **Antwort wird hart geprüft** (`src/domain/ai-pricing.ts`): nur bekannte Nächte, ganze Franken, immer in [Minimum, Maximum] der Regel (sonst auf die Grenze gesetzt und vermerkt), keine Dubletten, Begründung höchstens 160 Zeichen. Ungültiges wird verworfen und gezählt.
- **Immer Vorschlag**: KI-Vorschläge ersetzen offene Vorschläge nur für die Nächte, zu denen sie etwas sagt, und tragen die Marke «KI». Übernommen wird nach Bestätigung oder, wenn bei der Regel «automatisch übernehmen» eingeschaltet ist, automatisch und nur im Korridor (`applyProposals` prüft ihn erneut; Outbox und Audit wie bei jeder Preisänderung). Ist das KI-Modul an, übernimmt die Regel-Automatik nichts vorab.
- **Fehler**: Antwortet die KI nicht oder unbrauchbar, bleiben die Regel-Vorschläge, der Lauf wird als Fehler protokolliert, die Seite sagt es.
- **Auslösung**: Knopf «Mit KI neu berechnen» (Manager) und nächtlicher Job (`aiPricingJob`). Obergrenze `AI_PRICING_RUNS_PER_DAY` (Standard 3) Läufe je Hotel und Tag.
- **Gebühr / Bündel «KI-Zusatz»** (Migration 0060): Tarif `zusatz` in `ai_plans` (`includes_pricing = true`), CHF 29 pro Monat ohne MWST, 250 Chat-Gespräche inklusive, Zusatzpakete wie beim Chat. Einschalten über die Seite KI-Chat (Preisbestätigung, Karte nötig, erster Monat kostenlos, Kündigung zum Monatsende, Abrechnung mit der Plattformgebühr); schaltet `pricing_rules` mit ein. Die Preisempfehlung läuft, solange die Laufzeit des KI-Moduls läuft und die Bedingungen `includesPricing` enthalten; sie ist kein frei schaltbares Modul mehr (`ai_pricing` entfernt, alte Zeilen gelöscht). Die Einzeltarife des Chats («Basis») enthalten sie nicht.
- ASSUMPTION: Fair Use, höchstens 5 Tarife pro Lauf (`AI_MAX_PLANS_PER_RUN`). Ohne `ANTHROPIC_API_KEY` läuft nichts.
- Abnahme: `tests/unit/ai-pricing.test.ts`, `tests/integration/ai-pricing.test.ts` (mit simulierter KI-Antwort, inkl. Bündel, Kündigung, 5-Tarife-Grenze).

### 19.21 Angebote für Seminare, Gruppen und Feste (Modul `inquiries`, Raumzeilen mit Modul `resources`)
Kette: Anfrage (SPEC 19.x Website-Baustein) → Angebot → Annahme per Link → Raumreservation. Migration 0061 (`offers`, `offer_lines`), `src/domain/offers.ts`, `src/services/offers.ts`.
- **Erstellen:** Knopf «Angebot erstellen» bei einer Anfrage (Manager). Nummer `A-<Jahr>-<seq>` je Betrieb lückenlos (Hotelzeile gesperrt). Titel, Einleitung, Firma, Gültig bis (Standard 14 Tage), Positionen (Beschreibung, Menge, Preis brutto in Rappen, MWST-Art). Summen und MWST wie bei Rechnungen (`vatBreakdown`, Betrieb ohne MWST-Pflicht: kein Ausweis).
- **Raumzeilen:** Eine Position kann ein Angebot vor Ort (SPEC 19.11) mit Tag, Von, Bis, Personen verknüpfen. Preis 0 bei Menge 1: Preis des Angebots vor Ort (`priceOf`). Beim Erstellen wird **nichts** reserviert.
- **Senden:** nur mit mindestens einer Position und gültigem Datum; Entwurf ist nicht öffentlich, gesendete Angebote sind unveränderlich (neues Angebot erstellen). Mail `offer_sent` mit Link `/o/<token>`.
- **Kundenseite `/o/<token>`:** A4-Blatt, «Als PDF speichern / drucken» (Browser-Druckansicht wie bei Rechnungen), Annehmen oder Ablehnen mit Nachricht. Annehmen nur bei Status `sent` und bis einschliesslich Gültigkeitstag.
- **Annahme:** legt die Raumreservationen an (`createResourceBooking`, mit Sperre gegen Überbuchung), setzt die Anfrage auf erledigt und mailt das Hotel (`offer_accepted`). Ist ein Termin inzwischen belegt, werden bereits angelegte Reservationen zurückgenommen, das Angebot bleibt offen und der Kunde sieht, dass das Hotel sich meldet. Ablehnen: Mail `offer_declined`. Audit `offer.*`.
- ASSUMPTION: PDF = Druckansicht des Browsers (keine serverseitige PDF-Erzeugung, wie bei Rechnungen); Angebots-Mails und -Seite nur Deutsch (Mail auch Englisch); Zimmerblock (Gruppe) und Rechnung werden nicht automatisch angelegt, die Rezeption erstellt sie nach der Annahme unter Gruppen bzw. Rechnungen; keine Anzahlung, kein Verlängern der Gültigkeit (neues Angebot); Abgelaufen wird bei Ansicht berechnet, es gibt keinen Job. Abnahme: `tests/unit/offers.test.ts`, `tests/integration/offers.test.ts`, `tests/e2e/offers.spec.ts`.

### 19.22 Website-Schnittstelle (Modul `api`, Standard aus; Schlüssel mit Zweck `website`)
Für Hotels mit eigener Website (nicht Pontivo-Website): Verfügbarkeit, Preise und Buchung über eine kleine API, Bezahlung auf der sicheren Zahlungsseite. Migration 0062 (`api_keys.scope`: `pos` | `website`), `src/lib/api-auth.ts`, `app/api/v1/*`.
- **Schlüssel:** `Authorization: Bearer pnt_…`, je Betrieb, Seite `/admin/<hotel>/api` (Inhaber; Klartext nur einmal; widerrufbar; «zuletzt benutzt»). Der Betrieb kommt immer aus dem Schlüssel. Ein Kassen-Schlüssel (`pos`) funktioniert hier nicht und umgekehrt (403 `wrong_scope`). Grenze 60 Anfragen pro Minute und Schlüssel (Buchungen 30); Buchungen zusätzlich je Schlüssel und Gast-E-Mail (10 pro Stunde).
- **Aufrufe:** `GET /api/v1/hotel` (Betrieb, Sprachen, Zeiten, Zimmertypen, Tarife), `GET /api/v1/availability?checkin&checkout&adults&children&rooms&ages&lang` (Angebote wie auf der Buchungsseite, Rappen), `POST /api/v1/bookings` (gleiche Felder und Prüfungen wie `/api/bookings`, `terms_accepted: true` Pflicht; Antwort 201 mit `reference` und `checkout_url`; 409 ausgebucht), `GET /api/v1/bookings/<reference>` (Status).
- **Gebühr:** Buchungen über die API sind `source = direct`, es gilt dieselbe Plattformgebühr (1,9 %); die Schnittstelle kostet nichts extra. Bestätigung erst nach der Zahlung (Webhook), danach die Mails an den Gast wie bei jeder Direktbuchung.
- **Ausbau (Migration 0063):**
  - *Doppelte Aufrufe:* Header `Idempotency-Key` (8 bis 128 Zeichen) bei `POST /bookings`: gleicher Schlüssel und gleicher Inhalt liefert dieselbe Antwort mit `Idempotent-Replayed: true`, ohne neue Buchung (auch bei gleichzeitigen Aufrufen genau eine); anderer Inhalt 422; läuft die erste Anfrage noch 409. Nur 2xx-Antworten werden gespeichert (nach Fehlern darf wiederholt werden), Einträge 48 Stunden (`api_idempotency`).
  - *Storno:* `GET /bookings/<reference>/cancel` (Vorschau), `POST` storniert wie ein Gast (gleiche Fristen, Gebühr, Rückerstattung); schon storniert → 200 `already_cancelled`.
  - *Webhooks:* Adressen je Betrieb (höchstens 5, Admin-Seite), Ereignisse `booking.confirmed`, `booking.cancelled` (mit `refund_rappen`, `fee_rappen`), `booking.expired`, `ping` zum Testen. Nutzdaten ohne Gästedaten (`reference`, `status`, `checkin`, `checkout`, `adults`, `children`, `total_rappen`, `source`). Entstehen in derselben Transaktion wie die Buchungsänderung (`webhook_deliveries`), Versand durch den Worker jede Minute (`SKIP LOCKED`), Wiederholung nach 1 Min, 5 Min, 30 Min, 2 Std, 12 Std, 24 Std (7 Versuche), danach `failed`. Signatur `Pontivo-Signature: t=<unix>,v1=<HMAC-SHA256 über "t.Rumpf">`, Geheimnis je Adresse (`whsec_…`, nur einmal sichtbar, verschlüsselt gespeichert), Empfänger prüft Zeitstempel höchstens 5 Minuten alt. Gleiche Ereignis-ID bei Wiederholung. Zustellungen werden nach 30 Tagen gelöscht.
  - *Rückkehr:* `return_url` bei der Buchung; nur Ursprünge, die das Hotel erlaubt hat (https). Nach der Zahlung kehrt der Gast mit `reference` und `result=paid|cancelled` zurück. Die Buchung wird weiterhin nur durch die Zahlung bestätigt, nie durch die Rückkehr.
  - *OpenAPI:* `GET /api/v1/openapi.json` (öffentlich), Zusatzleistungen in `/hotel`, `extras` und `voucher_code` bei der Buchung.
- **Sicherheit:** Schlüssel nur als Hash gespeichert, optional mit Ablauf (90 Tage, 1 Jahr, unbegrenzt) und IP-Liste; Rumpf höchstens 64 KB (413); alle Antworten `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, restriktive CSP; 429 mit `Retry-After`; Buchungen zusätzlich je Schlüssel und Gast-E-Mail begrenzt; Betrieb immer aus dem Schlüssel; Webhook-Ziele nur https mit Domainnamen (keine IP, kein localhost/.local/.internal), vor jedem Versand wird der Name aufgelöst und **jede** Adresse geprüft (private, lokale, Link-Local, reservierte Bereiche gesperrt), keine Weiterleitungen, Zeitlimit 8 Sekunden; jede Buchung über die API steht im `audit_log` (`api:<Schlüssel>`).
- ASSUMPTION: Schlüssel nur serverseitig (kein CORS ausser bei OpenAPI; für reine Einbindung gibt es das Widget). Die IP-Liste vergleicht mit `X-Forwarded-For` des Proxys (Betrieb hinter eigenem Reverse-Proxy). Rate-Limit im Speicher (eine Instanz). Webhook-Ziele, die nach der Namensauflösung wechseln (DNS-Rebinding zwischen Prüfung und Verbindung), sind nicht ganz ausgeschlossen: das Risiko ist durch fehlende Antwort-Rückgabe an Pontivo-Nutzer und den Betrieb ohne interne Dienste im selben Netz klein, bei Bedarf Versand über einen Egress-Proxy. Nicht enthalten: Änderung von Buchungen über die API, Ereignisse für Buchungen aus Portalen.
- Abnahme: `tests/integration/website-api.test.ts`, `tests/integration/website-api-full.test.ts`, `tests/integration/website-api-change.test.ts` (19.24), `tests/unit/webhooks.test.ts`.

### 19.25 Stripe Checkout eingebettet
Ziel: Der Gast bleibt auf der Website des Hotels (oder der Agentur) und sieht die Zahlung als Teil der Seite. Es bleibt Stripe Checkout (gleiche Sessions, gleiche Webhooks, gleiche Buchungslogik); die Karteneingabe liegt in einem Stripe-Rahmen, Kartendaten erreichen nie unseren Server (SPEC 0.6). Quelle: Stripe-Doku «Embed a checkout page in your site» und `stripe.createEmbeddedCheckoutPage`.
- **Einstellung:** `hotels.content.payment.embedded` (Admin → Zahnrad → Zahlungsmethoden, nur Inhaber, nur mit `STRIPE_PUBLISHABLE_KEY`). Aus (Standard) = Weiterleitung wie bisher. Gehostet bleibt immer der Rückfall.
- **Session:** `ui_mode: "embedded_page"`, `return_url` (statt `success_url`/`cancel_url`), Direct Charge auf dem Konto des Hotels, Plattformgebühr wie bisher, Idempotenzschlüssel `checkout-emb-<Buchung>`. Antwort enthält `client_secret`. Bestätigt wird die Buchung wie bisher nur durch den Webhook, nie durch die Rückkehr.
- **Website:** `POST /api/bookings` liefert bei eingeschalteter Einstellung `client_secret`, `stripe_account`, `publishable_key`, `token` statt `checkout_url`. Das Formular zeigt dann den Stripe-Rahmen (`components/public/EmbeddedCheckout.tsx`, Stripe.js von `js.stripe.com`) und einen Link «Zahlung abbrechen» (`/b/<token>?cancelled_payment=1`, Reservierung läuft sonst nach 32 Minuten ab). Nach der Zahlung führt Stripe auf `/b/<token>?paid=1`.
- **API v1:** `embedded: true` bei `POST /bookings` liefert `checkout_url: null` und `client_secret`, `stripe_account`, `publishable_key`; die Agentur bindet Stripe.js mit dem Konto des Hotels ein. `return_url` der Agentur gilt als Rückkehr-Adresse.
- ASSUMPTION: Stripe.js wird mit `{ stripeAccount }` initialisiert (Direct Charges). Die abgerufene Doku nennt das nicht ausdrücklich; vor dem Einschalten bei einem Hotel mit einer Testbuchung im Stripe-Testmodus prüfen. Das Skript `https://js.stripe.com/endive/stripe.js` ist das in der Doku genannte. Gestaltung (Farben, Schrift, Dunkelmodus) stellt der Betreiber in den Branding-Einstellungen von Stripe ein, nicht in Pontivo.
- Alle Zahlungs-Sessions setzen `adaptive_pricing: { enabled: false }` (CHF bleibt CHF, keine Umrechnung nach Gast-IP). Der Rahmen füllt die Breite der Karte (`.stripe-embed`); Aufbau/Abbau laufen nacheinander (Stripe erlaubt nur ein eingebettetes Objekt).
- Abnahme: `tests/integration/embedded-checkout.test.ts`; Testlauf gegen Stripe-Testmodus siehe QUESTIONS.md.

### 19.26 Gestaltung: neuer Standard der Hotel-Websites, Tag- und Nachtmodus
Ziel: Hotel-Websites wirken nicht wie ein Baukasten-Standard (grünes Creme, Rahmen um alles, gleichförmige Karten) und folgen der Einstellung des Geräts (hell oder dunkel).
- **Neuer Standard «Ruhig»** (`layout-ruhig`, Schriftpaar «Editorial»): neutrale Fläche, grosses Titelbild mit Titel und Suche, Zimmer und Angebote mit Foto als Reihen (Bild und Text, abwechselnd links und rechts, auf dem Handy untereinander), kaum Rahmen und Rundungen, Knöpfe in der Farbe des Hotels oder in Tinte, wenn keine Farbe gesetzt ist. Gilt für neue Hotels und für Hotels ohne gewählte Einstellung (`layoutOf` und `fontOf`). **Alle bisherigen Layouts und Schriften bleiben wählbar**, ausdrücklich gewählte ändern sich nicht.
- **Tag und Nacht:** alle Layouts folgen `prefers-color-scheme`. Die Markenfarbe des Hotels wird im Nachtmodus automatisch aufgehellt (mindestens 4.5:1 auf dunklem Grund, `readableOnDark`) für Links, Knöpfe und Flächen; im Tagmodus unverändert (`readableOnWhite`). Kein Code pro Hotel: die Farbe ist ein Datenwert (`hotels.content.brand.color`).
- **Pontivo-Website:** Aufbau und Texte bleiben, die Farben wechseln auf Petrol (`#0b7285`, im Nachtmodus `#4fb7c9`) mit Bernstein (`#f59f00` bzw. `#ffc247`) für die Portal-Provision, auf kühlem Weiss bzw. dunklem Marineblau (`components/marketing/marketing.module.css`). Folgt `prefers-color-scheme`; Schrift auf Petrol und Bernstein hat in beiden Modi genug Kontrast (`--pv-on-keep`, `--pv-on-fee`, `--pv-fee-ink`). Admin (Pontivo) und Anmeldeseiten behalten vorerst ihre Farben.
- **Pontivo-Website, Aufbau (Nachtrag):** «Passend zu Ihrer heutigen Website» und «Baukasten» sind ein Abschnitt: Die Website ist ein Baustein (neue Website / eigene Website mit eingebetteter Buchung / volle Integration über die API, mit Hinweis, dass KI die Integration heute einfach macht). Hero-Grafik: Brücke über einen Fluss statt Berge. Funktionsüberschrift «Alles, was Sie als Gastgeber brauchen»; Upselling und Preisempfehlung sind als KI-Modul (vorschlagsbasiert, Freigabe durch den Gastgeber) beschrieben. Website-Varianten: drei gleichwertige Karten (neue Website von Pontivo mit Wartung inklusive / einfache Einbindung / volle Integration über die API) mit gezeichneter Beispiel-Website. Logo «P als Brücke» (Bogen mit Bernstein-Punkt) auf Website, App-Icons und Mails. Plattform-Unterseiten (Registrieren, Eignung, Rechtliches) nutzen dieselbe Kopfzeile, Farben und Schrift; am Handy steht «Anmelden» als Textlink neben «Registrieren». Hero mit Hintergrundfoto (überdachte Holzbrücke über einen Fluss, `public/marketing/hero-hell.webp` und `hero-dunkel.webp`, KI-generiert), links und unten in die Seitenfarbe verlaufend; Tag/Nacht je eigenes Bild. Bewegung (dezent, `components/marketing/ScrollEffects.tsx`): Inhalte gleiten beim Scrollen gestaffelt ein, Einstieg mit Bildüberblendung und wachsenden Balken, Kacheln und Knöpfe reagieren auf Hover; bei «Bewegung reduzieren» und ohne JavaScript ist alles sofort sichtbar. Link zu Pontivo heisst immer «Pontivo». Admin: Menü «Mehr» in zwei Spalten (Mein Betrieb inkl. Vertrieb, Konto); Seite «Funktionen» in vier Gruppen mit Ein/Aus-Schaltern (`MODULE_GROUPS`, `role="switch"`). Impressum: Betreiber Lynxora GmbH, Konradstrasse 1, 8400 Winterthur.
- Abnahme: `tests/unit/brand-dark.test.ts`, `tests/unit/richtext.test.ts`.

### 19.24 API: nachträgliche Änderung und White-Label-Ausbau
Ziel: Ein Anbieter (Website-Agentur) bindet die Buchung vollständig in die Website des Hotels ein; der Gast soll möglichst nichts von Pontivo sehen.
- **Umgesetzt: `PATCH /api/v1/bookings/<reference>`** (Migration nicht nötig). Erlaubt: `checkin` (gleiche Anzahl Nächte, gleiche Zimmer) und `guest` {`first_name`, `last_name`, `phone`}; `dry_run: true` prüft nur (Verfügbarkeit, Preis) und ändert nichts. Nur Buchungen im Status `confirmed` aus Direkt/Admin, nicht Portal, nicht nach Anreise.
  - Verschieben: eigene Nächte werden zuerst freigegeben, dann zum aktuellen Tarif neu bepreist und belegt, alles in einer Transaktion. **Nur wenn der Zimmerpreis gleich bleibt**; sonst 409 `price_differs` mit `current_rooms_rappen` und `new_rooms_rappen`, nichts wird geändert. Ausgebucht → 409 `sold_out`. Mit mehreren Zimmern und Kindern 409 `price_check_unavailable` (Kinderalter sind nicht je Zimmer gespeichert).
  - Folgen: Channex-Outbox für alten und neuen Zeitraum, Zimmerzuweisung wird aufgehoben, Fälligkeit der Restzahlung wandert um dieselbe Anzahl Tage, noch nicht gesendete Erinnerungen werden ersetzt, Gast erhält die Bestätigung mit den neuen Daten, Audit `api.booking.move` bzw. `api.booking.guest_update`.
  - Webhook `booking.changed` (Nutzdaten wie bei den anderen Ereignissen plus `changed`). Neue Adressen abonnieren es standardmässig; bestehende Adressen im Admin einmal speichern bzw. das Ereignis anhaken.
  - Absicherung: `Idempotency-Key` wie bei der Buchung (Probelauf wird nie gespeichert), Grenze 30 pro Minute, Betrieb aus dem Schlüssel.
  - ASSUMPTION: Kein Nachzahlen und keine Rückerstattung über die API (nur gleicher Preis), kein Verlängern/Verkürzen, kein Zimmerwechsel, E-Mail-Adresse des Gasts nicht änderbar. Das Hotel ändert den Rest im Admin.
- **Geplant (noch nicht gebaut, siehe QUESTIONS.md):**
  1. Neutrale Gästeseiten und E-Mails: Absendername und -adresse sowie Gestaltung des Betriebs statt Pontivo (bei Anbieter-Einbindung), eigene Domain für `/b/<token>`.
  2. Partner-Schlüssel: ein Schlüssel eines Anbieters für mehrere Hotels (Hotel muss je den Anbieter freigeben).
  3. Webhooks für Buchungen aus Portalen; Verlängern/Verkürzen mit Preisdifferenz.

### 19.23 App Pontivo (Android und iOS), Vorbereitung
Ziel: die Admin-Oberfläche (Pontivo) als App im Play Store und App Store. Weg: Hülle mit Capacitor im Ordner `mobile/`, die die gehostete Oberfläche lädt (keine zweite Codebasis). Anleitung: `mobile/README.md`. Migration 0064.
- **Im Server vorbereitet:** Erkennung der Hülle am User-Agent `MyPontivoApp` (`src/domain/app-links.ts`; «Als App installieren» entfällt); `POST/DELETE /api/admin/hotels/<id>/push/native` (Rolle ab Mitarbeitende) speichert Gerätekennungen (`native_push_tokens`, je Betrieb und Konto); Komponente «Mitteilungen in der App einschalten» auf «Mein Konto» (nur in der Hülle); `/.well-known/assetlinks.json` und `/.well-known/apple-app-site-association` aus `ANDROID_APP_PACKAGE`, `ANDROID_CERT_SHA256`, `APPLE_TEAM_ID`, `IOS_BUNDLE_ID` (leer = keine Einträge).
- App-Kennung `ch.pontivo.app` (Betreiber 22.11.2026: ohne «mypontivo»; Name und Adresse bestätigt). ASSUMPTION: Adresse `https://pontivo.ch/admin`, Name «Pontivo»; Mitteilungen laufen in der App über Firebase (Android) und Apple (iOS), nicht über Web-Push. Der Versand ist noch **nicht** gebaut (braucht Firebase-Projekt, APNs-Schlüssel, Dienstkonto; vorher die aktuelle FCM-Dokumentation lesen). Bildmaterial, Store-Texte, Datenschutz-Angaben für die Stores, Entwicklerkonten und der Mac für iOS stellt der Betreiber. Risiko: Apple kann reine Web-Hüllen ablehnen (Mindestfunktionalität), Gegenmittel siehe README.
- Abnahme: `tests/unit/app-links.test.ts`.

### 19.27 Kalender: Bedienung und Export
- Ansicht standardmässig 2 Wochen; Umschalter 2 Wochen / 1 Monat / 3 Monate (`?days=14|31|90`), Vor/Zurück um die gewählte Spanne, «Heute» und Datumsfeld zum direkten Springen (`?from=JJJJ-MM-TT`). Zelle zeigt nur freie Zimmer (Rot = ausgebucht); gebucht/gesperrt/extern im Tooltip.
- Formular «Preise und Regeln setzen»: Zeilen werden nur im Browser hinzugefügt und entfernt (`RateRows`), keine leeren Zeilen nach Reload.
- **Export** (`/admin/<hotel>/calendar/csv?from=&to=`, Rolle wie Kalender, höchstens 366 Tage): CSV mit Semikolon, UTF-8 mit BOM, eine Zeile je Tag und Rateplan (Zimmer gesamt, gebucht, gesperrt, extern, frei, Preis mit Punkt, Mindestnächte, Anreise/Abreise gesperrt, Verkaufsstopp); `audit_log` Aktion `calendar.export`. Knopf «Excel-Export» exportiert den angezeigten Zeitraum. Abnahme: `tests/unit/calendar-export.test.ts`.
- **Schutz vor Dauer-Abrufen:** alle CSV-Exporte (Kalender, Bericht, Buchhaltung, Gästeregister, Kurtaxe, HESTA, Kasse, Rooming, Migrationsvorlage) höchstens 20 je Person und Betrieb in 10 Minuten (`src/lib/export-limit.ts`, DB-Rate-Limit), danach Antwort 429 mit `Retry-After: 600`. Kalender-Export mit Von/Bis-Feld im Kalender («Excel-Export»).
- **Formulare:** Checkboxen und Radiobuttons einheitlich gestaltet (global in `app/globals.css`), Datumssymbol im Dunkelmodus sichtbar (`color-scheme`), «Zimmer sperren» in voller Breite.
- **Adressen (Stand 22.11.2026):** Die Oberfläche der Betriebe (Admin) liegt unter `/admin` (Login, Konto, Betriebe, PWA-Manifest, Service Worker). Die Plattform-Verwaltung liegt unter `/plattform` (nur Plattform-Admins; Link «Zu meinen Betrieben» führt nach `/admin`). «Mein Konto» ist `/admin/<hotelId>/konto`. Keine Weiterleitungen von früheren Adressen (`/mypontivo`, `/admin/plattform`): es gibt noch keine Echtbenutzer. Die Schnittstellen unter `/api/admin/...` bleiben unverändert.
- **Zeitnavigation einheitlich:** `PeriodNav` (‹ Heute › plus Sprungfeld) für Kalender, Heute, Zimmerplan, Reinigung, Tagesabschluss, Monatsabrechnung, HESTA und Kurtaxe-Liste; ein einziger Stil für `.seg`.
- **Reiter über der Seite:** nur der genaueste Reiter ist aktiv, keine Scrollleiste. Eingabefelder mit sichtbarem Rahmen (`--field-line`) und mehr Innenabstand; Dateiauswahl und Buttons mit Hover. KI-Chat lässt sich ohne API-Schlüssel nicht einschalten. Betragsanzeige `CHF` nie doppelt (`tests/unit/no-double-chf.test.ts`).
- **Abrechnung bei den Buchungen:** Die Monatsabrechnung ist ein Reiter im Bereich Buchungen (nicht mehr unter «Mein Betrieb»); auf der Buchungsliste (nur Manager/Inhaber) öffnet «Abrechnung exportieren» Monat, CSV und PDF. Die Abrechnung zählt nach Bestätigungsmonat und enthält Erstattungen und Plattformgebühr, die Liste nach Anreise.
- **Betriebsdaten:** Einstellungen zeigen nur noch Stammdaten des Betriebs. Titel und Einleitung der einfachen Startseite stehen auf der Seite Website (Abschnitt Startseite); das Betriebsdaten-Formular lässt sie unverändert.

### 19.28 Menü neu geordnet, Team, gemeinsamer Posteingang, Hilfe als Schulung
- **Menü:** Kopfzeile / untere Leiste mit vier Punkten **Mein Betrieb, Kalender, Buchungen, Gäste**; kein «Mehr». Alles Weitere liegt als Reiter (`src/admin/nav.ts`, Reiter können eine zweite Reihe haben, Trenner `sep` gliedern Gruppen).
  - **Mein Betrieb** (Menüpunkt, vorher «Übersicht»): Reiter Übersicht | Zimmer und Tarife | Website und Buchung (+ Schnittstelle/API) | Team | Einstellungen (Betrieb, Funktionen, Kartenterminal, Zutritt) | Statistik (+ HESTA) | Buchhaltung | Restaurant (+ Kassen-Schnittstelle).
  - **Kalender** (Zeitraster je Zimmertyp): Preise & Verfügbarkeit | Zimmerplan | Preisempfehlung | Channel-Manager | Kalender-Abgleich. **Buchungen** (Vorgänge): Buchungen, Heute, Reinigung, Gruppen, Angebote vor Ort | Rechnungen, Tagesabschluss, Debitoren | Plattformgebühren (vorher «Abrechnung»), Eigentümer. **Gäste:** Check-in (vorher «Gäste»), Kartei | Posteingang, Newsletter, Gutscheine, Bewertungen | KI-Chat, Upselling, Mail-Texte.
  - **Profilbild:** «Mein Konto» mit Reitern Profil & Sicherheit, Datenübernahme, Erste Woche, Hilfe (`nav.account`).
- **Website und Buchung** (`/site`): eine Seite. Betriebsart (nur Buchung / Pontivo ist die Website), Hauptfarbe, Gestaltung, Logo, Sprachen immer; bei «nur Buchung» zusätzlich Einbindung (Link, Knopf, Suchleiste), bei «Pontivo ist die Website» Startseite, Dokumente, weitere Seiten. `/embed` leitet dauerhaft hierher (`#einbinden`).
- **Gemeinsamer Posteingang** (`/inbox`): Anfragen (Website, Chat) und Portal-Nachrichten (Modul `inbox`) mit Quellenfilter. ASSUMPTION: zwei Abschnitte untereinander statt einer gemischten Zeitleiste. `/inquiries` leitet dauerhaft nach `/inbox?quelle=web`. Menüpunkt weg nur, wenn beide Module aus sind.
- **Getrennt nach Bereich (20.1):** Führt der Betrieb auch das Restaurant (Modul `restaurant`), gehören Anfragen der Art «Tisch» in den Posteingang der Gastronomie (`/inbox?bereich=restaurant`, Reiter unter «Heute» im Restaurant-Bereich); Gästewünsche, Portal-Nachrichten und alle übrigen Anfragen bleiben im Posteingang der Unterkunft. Ohne Restaurant bleibt alles in einem Posteingang. Zahlen und Mitteilungen folgen: neue Arten `dininginbox` (ungesehen/offen/Push «Anfragen (Restaurant)»), Migration 0094. ASSUMPTION: nur «Tisch» gehört zur Gastronomie, Gruppen, Seminare, Feste und Firmenanlässe bleiben bei der Unterkunft.
- **Team** (`/team`, nur Inhaber): Personen, Rollen wechseln, **eigene Rollen** mit Seiten per Häkchen (`hotel_roles`, Migration 0065; Mitglieder `role = 'custom:<id>'`, `CONFIGURABLE_AREAS` in `src/domain/roles.ts`). Eigene Rollen sind wie die eingeschränkten Standardrollen nie mehr als «staff» (Preise, Einstellungen, Team bleiben Inhaber/Manager). **Standardrollen anpassen:** Rezeption, Reinigung, Buchhaltung und Service (Service = Restaurant) lassen sich je Betrieb in Name und Seiten ändern (`hotel_role_overrides`, Migration 0066, `saveStandardRole` / `resetStandardRole`); ohne Eintrag gilt die Vorgabe, «Zurücksetzen» löscht ihn. Die Person behält in der DB ihre Standardrolle, aufgelöst gilt der angepasste Name mit den angehakten Seiten (`resolveRole`). Inhaber, Manager und Mitarbeitende sind abgestuft und bleiben fest. Löschen einer Rolle nur ohne zugewiesene Personen. Abnahme: `tests/integration/team.test.ts`.
- **Zimmertyp ohne Tarif:** «Neuer Zimmertyp» mit optionalem Startpreis legt den Tarif «Standard» an (ASSUMPTION: bis 2 Tage vor Anreise kostenlos stornierbar, danach 100 %, nur Übernachtung). Im Kalender zeigt ein Typ ohne Tarif den Hinweis «Kein Tarif» mit Link.
- **Hilfe als Schulung** (`/hilfe`, `/hilfe/ablaeufe`, `/hilfe/begriffe`; Inhalte in `src/domain/help-content.ts`): Wegweiser, «Kalender oder Buchungen?», Abläufe Schritt für Schritt je Rolle, Fachbegriffe mit «Was es bedeutet» und «So löst es Pontivo». Abnahme: `tests/unit/help-content.test.ts` (alle Verweise sind echte Menüpunkte).
- **Favicon:** Pontivo-Logo (Logo B) als `app/icon.png`, `app/apple-icon.png`, `app/favicon.ico` für alle Seiten ausser dem Admin, der sein eigenes PWA-Symbol hat. Plattform-Verwaltung im Stil von Pontivo (Kopfzeile, Karten je Betrieb, Löschen eingeklappt).

### 19.29 Direktbuchungs-Werkzeuge: Vorteile, Firmencodes, Lückenfüller, Warteliste, Abbruch-Mail
Seite `/admin/<hotel>/direktbuchung` (Reiter unter «Website und Buchung», Manager und Inhaber), Einstellungen in `hotels.content.direct`, Logik in `src/domain/direct-tools.ts`, DB-Teil in `src/services/direct-tools.ts`, Migration 0067.
- **Direktvorteile:** bis 4 Kurztexte (je 90 Zeichen, je Sprache, Deutsch ist Pflicht, optional ab N Nächten) im Buchungsfenster und in der Bestätigung. Sie werden mit der Buchung festgehalten (`bookings.direct_benefits`), spätere Textänderungen ändern bestehende Buchungen nicht.
- **Firmencodes** (`company_codes`): Code (A–Z, 0–9, `-`, 4–24 Zeichen) gehört zu einer Firma aus den Debitoren, Rabatt 0–50 % auf die Zimmerpreise, optional Gültigkeit (nach Anreisedatum) und «auf Rechnung». Ein ungültiger Code gibt immer einen Fehler (`code_invalid`), nie stillschweigend den Normalpreis. «Auf Rechnung» braucht das Modul Debitoren, die Buchung ist sofort bestätigt, die Firma hängt an der Buchung, es gibt keine Zahlung und keine Plattformgebühr; mit Gutschein nicht kombinierbar. API: `company_code` bei `/api/bookings`, `/api/v1/bookings` und `/api/v1/availability`.
- **Lückenfüller:** Eine Lücke sind 1–3 freie Nächte eines Zimmertyps zwischen zwei ausgebuchten Nächten. Ein Aufenthalt, der die Lücke genau füllt, darf den Mindestaufenthalt unterschreiten und bekommt optional bis 30 % Rabatt. Es gilt immer nur ein Rabatt (der höhere von Firmencode und Lückenfüller). Nur Direktbuchungen, der Channel-Manager wird nicht verändert.
- **Warteliste** (Standard an): Bei «ausgebucht» kann der Gast E-Mail und Wunschdaten hinterlassen (`waitlist_entries`, höchstens 5 offene je Adresse). Der Job `waitlist` (alle 5 Minuten) schickt einmalig eine Mail mit Link in die Suche, sobald etwas frei ist; Abmelden per Link in der Mail (`/api/waitlist/<token>`).
- **Abbruch-Mail** (Standard aus): Einmalige Erinnerung 30 Minuten bis 24 Stunden nach einer abgelaufenen, unbezahlten Direktbuchung (Job `booking-recovery`, alle 10 Minuten), nur wenn der Betrieb sie einschaltet, die Daten noch frei sind, der Gast nicht inzwischen gebucht hat und ihm in den letzten 7 Tagen keine solche Mail ging.
- Abnahme: `tests/unit/direct-tools.test.ts`, `tests/integration/direct-tools.test.ts`.

### 19.30 Rechnung an das Hotel, MWST-Schalter der Plattform, Testumgebung
- **Rechnung** (`platform_charges`, Migration 0068): Der Worker erstellt am 1. des Monats für jeden Betrieb mit Minimum, KI-Chat oder Gebühren im Vormonat genau eine Rechnung (Nummer `R-JJJJ-NNNNN` aus `platform_invoice_seq`, Datum, Netto, MWST-Satz, MWST, belasteter Betrag). Die Plattformgebühren (1,9 %) sind schon bei den Buchungen über Stripe einbehalten; von der Karte kommen die Differenz zur Mindestgebühr, der KI-Chat und die MWST (`billMonth` in `src/domain/platform-invoice.ts`). Ist nichts zu belasten, geht die Rechnung trotzdem per Mail (`host_invoice`, Status «nichts fällig»). Druckansicht («Als PDF speichern») unter `/admin/<hotel>/plattform-rechnung/<id>` (Manager), Links in den Mails und in der Tabelle unter Einstellungen.
- **Zahlungserinnerung:** Bei fehlgeschlagener Karte bleibt es bei der Mail `host_charge_failed` mit Rechnungsnummer, 3 Versuchen im Abstand von 3 Tagen und Hinweis an die Plattform. Die Plattform-Verwaltung kann einen Fehlversuch mit «Erneut versuchen» zurücksetzen.
- **MWST-Schalter** (Plattform-Verwaltung, `platform_settings` Schlüssel `vat`): MWST-pflichtig ja/nein, ab Datum, Satz (Standard 8,1 %), MWST-Nummer (Pflicht, wenn eingeschaltet), Protokoll `platform.vat_changed`. Preise der Plattform verstehen sich ohne MWST (Bedingungen für Gastgeber Ziffer 2), die MWST kommt obendrauf. ASSUMPTION: Leistungsdatum = letzter Tag des Abrechnungsmonats; beginnt die Pflicht mitten im Monat, gilt sie für den ganzen Monat. Ausgestellte Rechnungen ändern sich nie.
- **Testumgebung int** (`ENVIRONMENT_LABEL`, `MAIL_REDIRECT_TO`): sichtbarer Hinweis, `robots` gesperrt, keine echten Mails: `SMTP_URL` leitet alle Mails per SMTP an den Mail-Fänger Mailpit (Container `mailpit` im int-Stack, Oberfläche `int.<Domain>/mail` hinter dem Passwortschutz; fehlt `SMTP_URL`, gilt `MAIL_REDIRECT_TO` mit Postmark; `SMTP_URL` in der Produktion ist ein Fehler in `env-check.py`), eigener Docker-Stack (`deploy/docker-compose.int.yml`), Passwortschutz im Caddy, Freigabe für die Produktion per Tag `prod-…` (`deploy/release.sh`). Anleitung: `docs/DEPLOY.md` (Übersicht) und `docs/deploy/`. Abnahme: `tests/unit/environment.test.ts`, `tests/unit/platform-invoice.test.ts`, `tests/integration/platform-invoice.test.ts`.

### 19.31 Plattform-Verwaltung: Gesundheits-Ampel, Vertriebs-Cockpit, mehrere Admins
- **Plattform-Admins:** mehrere Personen (`users.is_platform_admin`), hinzufügen/entziehen in der Plattform-Verwaltung; nicht sich selbst, nie den letzten; Protokoll `platform_admin.added/removed` (`src/services/platform-admin.ts`).
- **Gesundheits-Ampel** (`src/domain/health.ts`, `src/services/health.ts`): je Betrieb Rot/Gelb/Grün mit Gründen. Rot: live ohne freigeschaltetes Stripe-Konto, nicht bezahlte Abrechnung, Preise nur noch < 14 Tage, Channex-Fehler (7 Tage), Entwurf seit ≥ 14 Tagen ohne Abschluss. Gelb: keine Karte, Preise < 60 Tage, Kalender-Abgleich mit Fehler, keine Direktbuchung in 30 Tagen (live ≥ 45 Tage), Buchungen halbiert (≥ 4 im Vorzeitraum), 30 Tage nichts im Admin bearbeitet, Entwurf ≥ 5 Tage offen, pausiert.
- **Vertriebs-Cockpit** (`/plattform/vertrieb`, Migration 0069 `sales_leads`, `sales_lead_events`): Leads mit Status (neu, kontaktiert, Demo, Angebot, gewonnen, verloren), Quelle, nächster Schritt, Notizen, Verlauf. Selbst registrierte Betriebe werden automatisch zu Leads (Abgleich beim Öffnen, auch Zusammenführung per E-Mail mit von Hand angelegten Leads); online geschaltet = gewonnen. Persönliche Mails aus Vorlagen (Erstkontakt, nach dem Gespräch, Nachfassen, Hilfe bei der Einrichtung) einzeln je Lead, nie Massenversand, gesperrt bei «nicht mehr kontaktieren». Kennzahlen: offen, fällig, neu in 7 Tagen, Abschlussquote. Abnahme: `tests/unit/sales.test.ts`, `tests/integration/sales.test.ts`, `tests/unit/health.test.ts`, `tests/integration/health.test.ts`, `tests/integration/platform-admins.test.ts`.

### 19.32 Monatsmail an den Inhaber, Wiederkehr-Mail
- **Monatsmail** (`src/domain/monthly.ts`, `src/services/monthly-mail.ts`): am Monatsanfang eine Zusammenfassung des Vormonats an den Inhaber (Buchungen, Umsatz, Direktanteil, Auslastung, Vergleich mit dem Vorjahresmonat); abschaltbar in den Einstellungen (`hotels.content.monthlyMail`).
- **Wiederkehr-Mail** (Standard aus, Abschnitt «Wiederkehr» auf der Seite Direktbuchung, Job `winback` täglich 10:10): Eine einzige Mail je Gast, wenn seine bestätigte Direktbuchung N Tage zurückliegt (Standard 330, einstellbar 200–400). Nur mit Einwilligung (`guests.marketing_consent`), nicht bei OTA-Buchungen, nicht wenn der Gast schon wieder gebucht hat oder eine solche Mail in den letzten 300 Tagen bekam. Der Link führt in die Buchung mit den Daten ein Jahr später (364 Tage, gleicher Wochentag), sonst in die leere Suche. Jede Mail enthält den Abmeldelink (`/abmelden`), der die Einwilligung widerruft. Protokoll `booking.winback_mail`.
- Abnahme: `tests/integration/monthly-mail.test.ts`, `tests/integration/winback.test.ts`, `tests/unit/direct-tools.test.ts`.

### 19.33 Feiertage und Schulferien als Vorschlag für die Preisempfehlung
- **Feiertage** (`src/domain/holidays.ts`): im Code berechnet (Ostern nach Gauss; Neujahr, Karfreitag, Ostermontag, Auffahrt, Pfingstmontag, 1. August, Weihnachten, Stephanstag, dazu je nach Kanton Dreikönig, Fronleichnam, Mariä Himmelfahrt, Allerheiligen, Mariä Empfängnis). ASSUMPTION: Die Zuordnung zu Kantonen ist vereinfacht und kann je Gemeinde abweichen; es sind Vorschläge.
- **Schulferien** (`school_holidays`, Migration 0070): Referenzdaten der Plattform ohne Mandantenbezug, in der Plattform-Verwaltung als CSV (`Kanton;Name;von;bis`) importiert, nie im Code. Ohne Import gibt es keine Schulferien-Vorschläge.
- **Übernahme:** Auf «Preisempfehlung» zeigt der Abschnitt «Feiertage und Schulferien» die Vorschläge der nächsten 13 Monate für den Kanton des Betriebs, ohne bereits eingetragene. Der Manager wählt aus und gibt je Art einen Zuschlag in % an; daraus werden Preis-Ereignisse (`pricing_events`). Die Preise ändern sich nicht von selbst, die Ereignisse fliessen nur in die Vorschläge der Preisempfehlung ein. Protokoll `platform.school_holidays_imported`, `pricing.event.add`.
- Abnahme: `tests/unit/holidays.test.ts`, `tests/integration/holidays.test.ts`.

### 19.34 Baustein «Auszeichnungen & Labels»
- Allgemeiner Baustein für alle Betriebe (`labels` in `src/domain/blocks.ts`): bis 12 Labels mit Name, Stufe (je Sprache), Kurztext, Logo aus der Foto-Bibliothek und Link (nur http/https, `rel="noopener nofollow"`). Typisch: Swisstainable, Familienfreundlich, Wellness-Label, Bio. Kein Code für einzelne Labels, kein Hotel-Sonderfall: ein Label ist Inhalt (Daten) des Betriebs.
- Der Hinweis im Editor mahnt: nur Labels zeigen, die der Betrieb tatsächlich führt (UWG). Pontivo prüft das Label nicht. Der KI-Chat kennt die Labels (`knowledge.labels`).
- Abnahme: `tests/integration/website-extras.test.ts`.

### 19.35 Pakete im Baustein «Angebote»
- Ein Paket ist ein Angebot im Baustein `offers` mit Tarif (Verpflegung, Mindestnächte, feste Anreisetage im Tarif), Beschreibung, **Inklusivleistungen** (eine pro Zeile, je Sprache) und optionaler **Gültigkeit** (`validFrom`, `validTo`, nach dem Enddatum verschwindet das Angebot von der Website und aus dem Wissen des KI-Chats). Der Preis kommt aus dem Tarif (Zimmerpreis der gebuchten Nächte), der Preis-Hinweis ist ein Freitext. Keine zweite Preislogik: Rabatte für Pakete laufen über den Tarif.
- ASSUMPTION: Inklusivleistungen sind Text; sie werden nicht einzeln abgerechnet (Verpflegung mit Wert ist im Tarif abgebildet, `meal_rappen`). Eine eigene Seite je Paket kann der Betrieb mit einer Seite und diesem Baustein anlegen.
- Abnahme: `tests/integration/website-extras.test.ts`.

### 19.36 Einrichten mit KI aus Website oder PDF
- Seite `/admin/<hotel>/ki-einrichten` (Manager), Link im Schritt «Unterkunft» des Assistenten. Quelle: Adresse der bestehenden Website (https, bis 5 Seiten derselben Domain über den SSRF-geschützten Abruf `safeFetchText`) oder ein PDF (bis 4 MB und 12 Seiten, geht als Dokument an die KI). Die KI (Modell `SETUP_MODEL`, Standard Haiku) liefert einen **Entwurf**: Einleitung, Zimmertypen (Name, Beschreibung, Personen, Anzahl) und häufige Fragen. Keine Preise, Telefonnummern, Links oder Codes. Quelltexte werden nicht gespeichert (`setup_imports`, Migration 0071: Quelle, Status, Zähler, Entwurf).
- **Erst nach Abo:** Karte für die Abrechnung hinterlegt und Gastgeber-Bedingungen akzeptiert (`setupImportGate`).
- **Kostenbremsen:** `SETUP_RUNS_PER_MONTH` Läufe je Betrieb (Standard 3, inkl. fehlgeschlagener; nicht erreichbare Website zählt nicht), `SETUP_RUNS_PER_DAY_TOTAL` Läufe aller Betriebe je 24 Stunden (Standard 100), höchstens 24 000 Zeichen Text, 3000 Antwort-Tokens, Prüfung der Grenzen vor dem KI-Aufruf, Sperre je Betrieb gegen Doppelklick.
- **Übernahme nach Prüfung:** gewählte Zimmertypen werden ohne Preise angelegt (bereits vorhandene Namen übersprungen), Fragen als Baustein «Häufige Fragen» auf die Startseite, Einleitung nur wenn noch keine steht. Danach werden die Entwurfsdaten gelöscht. Protokoll `setup_import.start/adopt/discard`. Der Text der Quelle gilt als nicht vertrauenswürdig (Anweisung in der KI-Vorgabe, Prüfung durch den Betrieb).
- Abnahme: `tests/unit/setup-import.test.ts`, `tests/integration/setup-import.test.ts`.

### 19.37 Deploy-Zugänge (Windows-Programm)
- Zum Ausrollen vom PC aus gibt es pro Person einen **eigenen Zugang**: eigener SSH-Schlüssel mit erzwungenem Befehl (`deploy/deploy-gate.sh <name>`, `restrict`, kein Terminal, kein Port-Forwarding) und eigenes **Passwort** (`$6$`-Hash in `/etc/pontivo-deploy/users`, nie im Klartext, nie im Protokoll). Das Passwort kommt als erste Zeile über stdin, nicht in der Befehlszeile.
- Erlaubte Aktionen: `test`, `status`, `int`, `prod` (alles andere wird abgelehnt); Namen nur `^[a-z][a-z0-9_-]{1,19}$`. Ein Ausroll-Vorgang zugleich (`flock`). Protokoll `/var/log/pontivo-deploy.log` (Person, Zeit, Aktion, Fehlversuche). Verwaltung: `deploy/deploy-user.sh add|passwd|remove|list|log`.
- Das Windows-Programm (`tools/PontivoDeploy`) erzeugt den Schlüssel auf dem PC der Person und zeigt den Befehl für den Server. Es folgt dem hellen/dunklen Modus von Windows.
- ASSUMPTION: `ubuntu` darf `sudo -n` ohne Passwort. Schutz gegen Raten nur über 3 s Wartezeit und Protokoll (SSH-Zugang selbst bleibt nur mit Schlüssel möglich, ein Angreifer braucht also Schlüssel UND Passwort).
- Abnahme: `tests/unit/deploy-gate.test.ts`.

### 19.38 Plattform-Verwaltung: Menü und Seiten
- Die Plattform-Verwaltung (`/plattform`) ist nach Themen in Seiten und Unterseiten gegliedert, mit demselben Menü- und Reiter-Stil wie Pontivo (`src/admin/platform-nav.ts`, `AdminNav`, `SectionTabs`): **Übersicht** (Kennzahlen, «Braucht Aufmerksamkeit», Bereiche) · **Betriebe** (Betriebe | Benutzer) · **Vertrieb** · **Abrechnung** (Rechnungen | MWST) · **Plattform** (Plattform-Admins | Website-Texte | Schulferien). Am Handy untere Leiste mit den fünf Hauptpunkten.
- Alle Aktionen liegen in `app/plattform/actions.ts`; jede Seite sendet ihren Pfad in `to` mit und kehrt dorthin zurück (erlaubte Ziele sind festgelegt). Alte Anker wie `/plattform#schulferien` gibt es nicht mehr.
- Abnahme: `tests/unit/platform-nav.test.ts`.

### 19.39 Fotos, Zimmertypen, Kurzinfos
- Fotos des Hotels liegen unter «Website und Buchung» (`#hotel-photos`), Fotos je Zimmertyp unter «Zimmer und Tarife». Beide nutzen `PhotoManager`/`PhotoGrid`: Reihenfolge per Drag & Drop (Maus: Bild ziehen; Touch: Griff unten links), das erste Foto ist automatisch das Titelbild; rotes ✕ oben rechts entfernt (mit Rückfrage). Es gibt keine Knöpfe «Als Titelbild»/«Entfernen» mehr.
- Server: `reorderPhotos` (`src/services/rooms.ts`; unbekannte Adressen ignoriert, nicht genannte Fotos bleiben hinten, Audit `photo.order`), Aktion `photoAction` (`app/admin/[hotelId]/photo-actions.ts`, kehrt auf die Ursprungsseite zurück). Upload-Route kennt `from=site|wizard|einrichten`.
- Zimmertypen sind standardmässig zugeklappt (Vorschaubild, Name, Anzahl Zimmer, Anzahl Tarife, Hinweis «ohne Tarif»/«nicht buchbar»); Aufklappen zeigt Bearbeiten (Stift-Symbol), Fotos und Tarife. Ein Anker `#rt-<id>` klappt die Karte auf (`OpenOnHash`).
- Kurzinfos: Elemente mit `data-tip`/`data-tip-title` zeigen eine einheitliche Kurzinfo (`TooltipHost`, Maus, Antippen, Tastatur) statt des Browser-Tooltips; verwendet im Kalender (frei/gebucht/gesperrt/extern) und im Zimmerplan.
- Aktive Umschalter (`.seg`, Sprach-Reiter) sind dezent (leichte Tönung statt voller Akzentfläche). Der Passkey-Hinweis-Banner entfällt (Passkey bleibt freiwillig unter «Mein Konto»).
- Abnahme: `tests/integration/rooms.test.ts` (Reihenfolge), `tests/e2e/onboarding.spec.ts` (Drag & Drop).

### 19.40 Umgebungsdatei prüfen
- `deploy/env-check.py <datei> [--env int] [--write]`: liest die Datei auf dem Server, vergleicht mit den im Code und in den Docker-Dateien gelesenen Namen und meldet Fehler (Testschlüssel in Produktion, `PAYMENT_PROVIDER=fake`, `MAIL_REDIRECT_TO`/`ENVIRONMENT_LABEL` in Produktion, Live-Schlüssel in der Testumgebung, nicht-https `APP_BASE_URL`), fehlende Pflichteinträge, Hinweise und Überflüssiges. Gibt nie Werte aus; `--write` schreibt nur eine Kopie `<datei>.neu`.
- Abnahme: `tests/unit/env-check.test.ts`.


### 19.41 Gästeportal: Wünsche, Tipps, Türcode, Rechnung, Check-out
Erweitert die Buchungsseite `/b/<token>` (SPEC 19.13). Zugang bleibt der Link (kein Login). Alle Hotels laufen auf demselben Code, Unterschiede sind Daten (`hotels.content.portal`, Einstellungen unter «Gäste → Gästeportal», Manager).
- **Wünsche:** Wunschliste des Betriebs (Standard: Late Check-out, Early Check-in, Handtücher, Kissen/Decke, Babybett, ruhiges Zimmer, in fünf Sprachen; abwählbar, eigene Wünsche ergänzbar) plus freier Text (500 Zeichen). Tabelle `guest_requests` (Buchung, Wunsch, Status `open`/`done`, Antwort an den Gast). Nur für bestätigte Buchungen bis zum Abreisetag (Hotelzeit). Obergrenzen je Buchung: 5 offene, 20 insgesamt (Buchung wird gesperrt, gleichzeitige Absendungen umgehen die Grenze nicht). Jeder Wunsch löst Mail (`guest_request`, nicht je Buchung zusammengefasst), Push und Audit aus. Der Gast sieht Liste und Status (offen/erledigt, mit Kurzantwort).
- **Posteingang:** Reiter «Gästewünsche» (mit Zahl offener Wünsche); Rezeption markiert «Erledigt» mit optionaler Kurzantwort oder öffnet wieder. Frühstück und andere Bezahl-Extras bleiben bei «Upselling» (Online-Zahlung), nicht als Gratiswunsch.
- **Tipps und Infos:** Liste von Einträgen (Titel, Text, Deutsch/Englisch, übrige Sprachen mit Rückfall) neben dem Freitext «Infos für den Aufenthalt». Der KI-Chat liest dieselben Einträge (`HotelKnowledge.stayTips`), nie Türcodes.
- **Türcode:** zeigt den Nuki-Code (SPEC 18.5) im Portal, wenn: Modul «Zutritt» an, Einstellung an, Code `active`, jetzt im Gültigkeitsfenster, Anreisetag erreicht und – falls das Modul «Gäste» läuft – der Online-Check-in ausgefüllt ist (sonst Hinweis). Reine Logik `doorCodeVisible` (`src/domain/portal.ts`).
- **Rechnung bis jetzt:** während des Aufenthalts Posten aufs Zimmer (`folio_items`, z. B. Restaurant) und offener Betrag, nur Anzeige. ASSUMPTION: Beträge brutto wie in der Hotelrechnung, Stand ohne Gewähr; die Schlussrechnung bleibt Sache der Rezeption.
- **Selbst-Check-out:** am Abreisetag Knopf «Ich checke jetzt aus» (`bookings.guest_checkout_at`, Migration 0073). Die Buchung bleibt bestätigt; Vermerk in «Heute» und Eintrag im Posteingang, damit die Rezeption Zimmer, Schlüssel und offene Posten prüft. Zahlung und Türcode-Widerruf laufen unverändert (Code endet zur Check-out-Zeit).
- Abnahme: `tests/unit/portal-guest.test.ts`, `tests/integration/guest-portal.test.ts`.

### 19.42 Navigation von Pontivo nach Häufigkeit
Ersetzt den Menüaufbau aus SPEC 19.x «Menü» (vier Punkte Mein Betrieb/Kalender/Buchungen/Gäste). **Seitenschlüssel und Adressen bleiben unverändert**, `ROLE_AREAS` und die `navKeys` der Module ebenso; nur Gruppierung und Beschriftung ändern sich (`src/admin/nav.ts`, `Nav = { primary, settings, account }`).
- **Hauptpunkte** (Kopfzeile am Desktop, untere Leiste am Handy): **Heute** (Tagesliste, Posteingang, Check-in [Seite «Check-in und Meldeschein»], Reinigung, Restaurant mit Tische/Kasse/Kassenabschluss) · **Kalender** (Zimmerplan nur mit Modul «Rezeption», Preise & Verfügbarkeit, Preisempfehlung; Ziel des Punkts = erster Reiter) · **Buchungen** (Buchungen, Gruppen, Angebote vor Ort, Gutscheine, Gäste mit Kartei/Newsletter/Bewertungen) · **Finanzen** (Rechnungen, Tagesabschluss, Debitoren, Eigentümer, Statistik mit HESTA, Buchhaltung). Ausgeschaltete Module blenden Reiter aus; eine Gruppe mit nur einem Reiter wird zum einfachen Punkt.
- **Zahnrad «Einstellungen»** oben rechts, nur Inhaber und Manager (`visibleNav`, `src/admin/visible-nav.ts`). Seite `/admin/<hotelId>/einstellungen` (`requireHotel(…, "manager")`) mit Gruppen: **Betrieb** (Betriebsdaten mit Öffnungszeiten und Kurtaxe, Funktionen mit Darstellung des Umschalters, Team & Rollen, Geräte mit Kartenterminal und Zutritt, Zahlungsmethoden, Abrechnung, Datenübernahme), **Unterkunft** (seit 24.11.2026: Zimmer & Tarife, Zusatzleistungen, Angebote vor Ort, Gästeportal, Upselling, KI-Chat; für reine Restaurants ausgeblendet), **Verkauf** (Website & Buchung mit dem Schalter «Online-Buchung» live/pausiert, Kanäle, Gäste-Mails), **Gastronomie** (nur mit Funktion «Restaurant»: Speisekarte, Tischplan, Reservierung, Bestellung, Kasse mit Kassen-Geräten und Kassen-Schnittstelle; die Kasse gibt es nur im Restaurant-Bereich). Die Gruppe «Technik» entfällt. Am Desktop stehen die Gruppen auf allen Zahnrad-Seiten als Seitenleiste links (`SettingsFrame`), Unterreiter bleiben Reiter. **Abo & Gebühren** (Seiten `report`, `report/print`, `report/csv`, `plattform-rechnung`) nur Inhaber, auch serverseitig.
- **Kopfzeile links:** das Pontivo-Logo (P als Brücke, Link zu «Betrieb wechseln», Text «Pontivo» für Screenreader) und der Name des Betriebs; so bleibt mehr Platz für lange Namen.
- **Profilbild** oben rechts: Menü «Mein Konto» mit Profil & Sicherheit, Erste Woche, Hilfe, Abmelden. «Betrieb wechseln» und Einrichtungs-Chip bleiben oben links.
- **Tagesliste** (`home`, erster Reiter von «Heute»): Anreisen, Abreisen und Gäste im Haus für jeden Tag (‹ Heute ›, Datumsfeld, `?day=YYYY-MM-DD`; Vorschau), auch ohne Modul «Rezeption» (dann ohne Zimmerplan-Knopf). Die frühere Seite «An- & Abreisen» (`frontdesk`) ist entfernt, Bereich in Rollen heisst jetzt `tag` (Migration 0074 benennt `frontdesk` in eigenen und angepassten Rollen um; die Rolle Rezeption landet auf «Tagesliste»). Nur für heute zusätzlich: Hinweise (je mit Link auf die passende Einstellung: Kanal gestört → Kanäle, Foto fehlt → Zimmer & Tarife, offene Wünsche/Anfragen → Posteingang), Einrichtung, Anreisen/Abreisen heute, offene Zahlungen (`src/services/today.ts`, `src/domain/day-notices.ts`). Kennzahlen mit Zeitraum und «Ihr Nutzen» liegen unter Finanzen → Statistik, die Provision der Portale unter Zahnrad → Kanäle. Mitarbeitende (`staff`) sehen «Tagesliste».
- **Rollen:** `CONFIGURABLE_AREAS` mit Gruppen Heute/Kalender/Buchungen/Finanzen. Eingeschränkte Rollen sehen kein Zahnrad und kein «Tagesliste», landen auf ihrer Seite (`LANDING`) und haben nie ein leeres Menü.
- Abnahme: `tests/unit/admin-nav.test.ts`, `modules.test.ts`, `roles.test.ts`, `day-notices.test.ts`, `tests/e2e/navigation.spec.ts`.

### 19.43 Anmeldung mit Passwort
Normaler Weg ist **E-Mail und Passwort** (optional mit 2FA), gleichwertig **Passkey** (optional mit 2FA). Der E-Mail-Link bleibt hinter dem Link «Passwort vergessen?» (Einladung, erste Anmeldung, Zurücksetzen).
- **Speicher:** `users.password_hash` (Migration 0075), scrypt (N=16384, r=8, p=1) mit eigenem Salz, Format `scrypt1$<Salt>$<Hash>` (`src/auth/password.ts`). Nie Klartext. Mindestens 8, höchstens 200 Zeichen, sonst keine Zusammensetzungsregeln. Kein Passwort = Anmeldung weiter per Passkey oder E-Mail-Link.
- **Anmelden** (`/admin/login`): Server-Aktion `passwordLogin` mit Formularschutz (Zeitprüfung, Turnstile wie beim Link), Begrenzung je IP 30 und je Adresse 10 Versuche pro 10 Minuten. Falsche Eingabe, unbekannte Adresse und «Nur Passkey» geben dieselbe Meldung (gleiche Rechenzeit über einen Blind-Hash, keine Auskunft über Konten). Mit aktiver Authenticator-App folgt wie bei jedem Weg die Seite `/admin/login/2fa`, erst danach die Sitzung.
- **«Nur Passkey»** sperrt neben dem E-Mail-Link auch das Passwort.
- **Passwort setzen/ändern:** «Profil & Sicherheit» (`/api/account/password`): ohne bestehendes Passwort genügt die angemeldete Sitzung (nach Link oder Passkey), sonst ist das aktuelle nötig. 10 Versuche pro Minute je Benutzer.
- **Login-Seite:** Karte mit Logo, grosse **Passkey-Kachel** (Fingerabdruck-Symbol, «Fingerabdruck, Gesicht oder Gerätecode. Kein Passwort nötig.»), darunter «oder mit Passwort». Auf Geräten, auf denen schon ein Passkey benutzt oder angelegt wurde (Merker `localStorage` `pontivo.passkey`, nur ein Hinweis), startet der Passkey beim Öffnen von selbst; nicht nach einer Fehlermeldung. Sonst Passkey-Vorschlag im E-Mail-Feld (Conditional UI). Ohne WebAuthn-Unterstützung fehlt die Kachel.
- **Bestehende Konten (Test):** `scripts/set-password.ts <E-Mail> "<Passwort>"` für ein Konto; `--alle-test "<Passwort>"` setzt es für alle Konten ohne Passwort, nur mit `ENVIRONMENT_LABEL=int` oder `dev` (nie auf der Produktion).
- Abnahme: `tests/unit/password.test.ts`, `tests/integration/password.test.ts`, `tests/e2e/password-login.spec.ts`, `tests/e2e/mfa.spec.ts`.

### 19.44 Zimmer & Tarife: Karten und Seitenleiste
- **Liste:** jeder Zimmertyp ist eine ganze Karte (Foto, Name, «N Zimmer · bis M Personen», Tarife als Chips, am Rand «Bearbeiten ›»; mit Leserecht «Ansehen ›»). Ein Klick irgendwo auf die Karte öffnet die Seitenleiste. «+ Zimmertyp hinzufügen» steht oben rechts.
- **Seitenleiste** (rechts, Hintergrund abgedunkelt, auf dem Handy volle Breite) mit Reitern **Grunddaten · Fotos · Tarife (n)**; Zustand nur in der URL (`?rt=<id>&tab=grunddaten|fotos|tarife`, `&plan=<id>|neu`, `?neu=1` für einen neuen Zimmertyp). Speichern lässt die Leiste offen; Abbrechen, Klick auf den Hintergrund, ✕ und Esc schliessen sie (`components/admin/DrawerKeys.tsx`). Fotos-Aktionen und «Tarif anlegen» im Kalender führen in die jeweilige Leiste zurück.
- **Zusatzleistungen** sind ein eigener Punkt unter Zahnrad → Betrieb (unterhalb von «Zimmer & Tarife», `rooms/extras`), nicht mehr ein Knopf auf der Zimmerseite.
- **Ungespeicherte Änderungen:** Wurde in der Leiste etwas getippt, fragt jedes Verlassen (Esc, ✕, Hintergrund, Abbrechen, Reiter, Karte, Seite neu laden) vorher nach; Speichern zählt nicht (`DrawerKeys`).
- **«Foto fehlt»** auf der Tagesliste führt direkt in den Fotos-Reiter des ersten betroffenen Zimmertyps (`?rt=<id>&tab=fotos`).
- Abnahme: `tests/e2e/rooms-drawer.spec.ts`, `tests/unit/admin-nav.test.ts`.

### 19.45 Reinigung: Karten und Statusfarben
- Gleiches Muster wie 19.44: Zimmerkarten im Raster (`.hk-grid`), oben eine Zusammenfassung mit Zählern je Status.
- **Statusfarben:** Schmutzig = rot, Sauber = blau, Geprüft = grün (Karte mit farbigem Kopfstreifen, Statuspunkt und -schild). Statuswechsel über drei gleich breite Schalter «Schmutzig · Sauber · Geprüft» (kein ✓/✓✓ mehr); der aktuelle Status ist ausgefüllt und gesperrt. Zeichen ausser Farbe: Text im Schild und `aria-pressed`.
- **Nur heute änderbar:** Der Status gilt für das Zimmer jetzt (nicht je Tag). An anderen Tagen bleibt die Tagesnavigation als Vorschau (Anreisen/Abreisen, Zwischenreinigungen) bzw. Rückblick, die Schalter sind gesperrt.
- Sortierung: schmutzig, Anreise heute, offene Aufträge, übrige. «Mangel melden / Auftrag» öffnet eine Seitenleiste (`?room=<id>`) mit einem Formular: Auswahl **Mangel** (etwas ist defekt, bleibt offen bis «Erledigt») oder **Extra-Auftrag** (zusätzliche Reinigung an diesem Tag), Beschreibung, offene Mängel des Zimmers mit «Erledigt». Hinter ⓘ erklärt ein Text, was Schmutzig, Sauber und Geprüft bedeuten (Geprüft = zusätzlich von der Leitung kontrolliert, optional).
- Abnahme: `tests/e2e/housekeeping-ui.spec.ts`, `tests/integration/housekeeping.test.ts`.

### 19.46 Meldeschein als Funktion, Berichte
- **«Online-Check-in & Meldeschein»** ist ein normales Modul `guests` (Einstellungen → Funktionen → Gäste und Kommunikation, Standard aus; Migration 0076 benennt den Rollenbereich `guests` in `reports` um). Die Sonderseite «Check-in» entfällt; die alte Adresse `/guests` leitet auf Berichte.
- **Tagesliste:** Mit dem Modul zeigt die Liste der Anreisen die Spalte «Meldeschein»: offen · ausgefüllt (mit Knopf «Ausweis gesehen») · Ausweis geprüft.
- **Berichte** (`/berichte`, Finanzen, Bereich `reports`): alle Exporte als Karten gleichen Aufbaus (`components/admin/ExportCard.tsx`): Titel, Satz, Zeitraum, Knöpfe. Zeitraum als ‹ Monat › (bzw. Quartal/Jahr mit Umschalter, von–bis beim Gästeregister), ohne «Anzeigen»-Knopf. Karten: Buchungsabrechnung (Inhaber), Kurtaxe-Liste (Manager, mit Modul), Gästeregister (mit Modul), HESTA (mit Statistik), Buchhaltung (mit Funktion). Die Seiten Buchhaltung und HESTA bleiben für Kontenzuordnung und Vorschau.
- **Mein Konto:** das Profilbild öffnet direkt die Seite (Reiter Profil & Sicherheit, Erste Woche, Hilfe; Abmelden dort), kein Untermenü.
- **Monatswahl Eigentümer:** wie überall `PeriodNav` (‹ Letzter Monat ›, Sprungfeld).
- Abnahme: `tests/e2e/reports.spec.ts`, `tests/unit/admin-nav.test.ts`, `roles.test.ts`, `help-content.test.ts`.

### 19.47 Einstellungen, Zahlungsmethoden, Meldungen
- **Übersicht** (Zahnrad): gruppierte Liste (Betrieb, Verkauf, Technik), eine Spalte, ganze Zeile antippbar mit › (`.set-list`); funktioniert am Handy wie am Desktop. Die Seitenleiste enthält keinen «Übersicht»-Punkt mehr, das Zahnrad führt dorthin.
- **Betriebsdaten** (früher «Grunddaten»): Name und Adresse, Öffnungszeiten (mit Restaurant-Funktion), Kurtaxe. Der Schalter «Online-Buchung» (Live schalten/Pausieren, Inhaber) steht auf «Website & Buchung»; Name und Symbol des Restaurant-Bereichs im Umschalter unter «Funktionen → Darstellung». Kein Team-Abschnitt (eigene Seite «Team & Rollen»).
- **Zahlungsmethoden** (`/zahlungen`, unter Grunddaten): Stripe-Konto (Karte, TWINT, eingebettete Zahlung), Anzahlung, Grundgebühr und Karte (frühere Abschnitte der Grunddaten).
- **Monatsmail** ist ein Modul `monthlymail` unter Funktionen, Standard **aus** (Migration 0077 übernimmt ausdrücklich Eingeschaltete). Ersetzt `content.monthlyMail`.
- **Schalter:** An/Aus-Zeilen wie unter Funktionen auch in Formularen (`components/admin/FormSwitch.tsx`, speichert mit dem Speichern-Knopf). Gästeportal: Wünsche melden, jeder Standardwunsch, Rechnung zeigen, Selbst-Checkout, Türcode.
- **Rückmeldungen:** `Notice` (`src/domain/msg-tone.ts`) zeigt Erfolg grün, Fehler und «hat nicht geklappt» rot mit `role=alert`; alle `?msg=`-Seiten nutzen es.
- **Abstände:** 28 px zwischen Boxen; am Handy genug Platz über der festen Menüleiste.
- **Heute:** Reiter Tagesliste · Posteingang · Reinigung · Restaurant.
- Abnahme: `tests/unit/msg-tone.test.ts`, `admin-nav.test.ts`, `tests/integration/monthly-mail.test.ts`.

### 19.48 Restaurant in den Einstellungen, CSV-Import, Menü-Zuordnung
- **Zuordnung im Menü:** Der genauere Treffer gewinnt (`inSettings`, `isActiveIn`, `sectionFor` in `src/admin/nav.ts`): eine Zahnrad-Seite unter einer Adresse von «Heute» (z. B. `restaurant/artikel` gegenüber `restaurant`) bleibt im Zahnrad und das Menü springt nicht mehr um.
- **Speisekarte** (Einstellungen → Gastronomie, `restaurant/artikel`, Modul `pos`): Artikel, Tische, Import. **Kassen-Geräte** (Einstellungen → Gastronomie → Kasse, `restaurant/geraete`): Gerätecodes und Freigabe, Bon-Nummernkreise.
- **CSV-Import** (Manager): Artikel (`kategorie;name;preis;mwst_haus;mwst_takeaway;tagesangebot`, leere MWST = 8,1 % / 2,6 %) und Tische (`name`), `;` oder `,`, höchstens 500 Zeilen und 1 MB. Alles oder nichts: bei einem Fehler wird nichts gespeichert und die Zeile genannt; Gleiches (Kategorie und Name bzw. Tischname) wird übersprungen. Vorlagen unter `restaurant/vorlage?kind=items|tables`; Protokoll `pos.items_import`, `pos.tables_import` (`src/domain/pos-import.ts`, `src/services/pos.ts`).
- Abnahme: `tests/unit/pos-import.test.ts`, `tests/unit/admin-nav.test.ts`, `tests/e2e/reports.spec.ts`.

### 19.49 Restaurant ausbauen (Etappen)
Auftrag des Betreibers: Optionen und Sonderwünsche je Artikel, Menüs/Kombis, Küchenanbindung, grafischer Tischplan mit Reservierungen (intern und online für Gäste), KI-Speisekarte. Etappen: **A** Optionen/Menüs (hier), **B** Küchenbildschirm im Browser, **C** Tischplan und Reservierungen, **D** KI-Speisekarte (Restaurant-Seite, nicht Datenübernahme).

**Etappe A: Optionen, Sonderwünsche, Menüs und Kombis**
- **Optionsgruppen** (`pos_option_groups`: Name, Pflicht, Mehrfachwahl mit `max_choices`) mit **Optionen** (`pos_options`: Name, Aufpreis in Rappen, aktiv). Eine Gruppe kann mehreren Artikeln zugeordnet werden (`pos_item_groups`), z. B. «Garstufe» für alle Steaks.
- **Menüs und Kombis** sind kein eigener Typ: ein Artikel mit Pflicht-Gruppen ohne Aufpreis (z. B. «Vorspeise: Suppe / Salat», «Hauptgang: …»). Der Artikelpreis ist der Menüpreis, Aufpreise einzelner Optionen kommen dazu.
- **Sonderwunsch:** freier Text je Zeile («ohne Zwiebeln», höchstens 120 Zeichen).
- **Bestellzeile:** `description` enthält Artikel, gewählte Optionen und Sonderwunsch («Entrecôte · medium · ohne Zwiebeln»), `unit_price_rappen` = Artikelpreis + Aufpreise; so erscheinen sie unverändert auf Bon und Zimmerrechnung. Zusätzlich `options` (jsonb, `[{group,name,priceRappen}]`) und `note` für Küche und Auswertung (Spalten nur beim Einfügen gesetzt, Bestellzeilen bleiben unveränderbar).
- **Prüfung auf dem Server** (`src/domain/pos-options.ts`): Optionen müssen zu den Gruppen des Artikels gehören, Pflicht-Gruppen brauchen mindestens eine Wahl, Einzelwahl höchstens eine, Mehrfachwahl höchstens `max_choices`. Ohne Angaben bei Pflicht-Gruppen: «Bitte wählen: …». Offline (Snapshot) gilt der Preis, wie ihn das Gerät zeigte; die Optionen werden geprüft, der Betrag nicht neu gerechnet.
- **Oberfläche:** Restaurant (Einstellungen → Verkauf): Karte «Optionen und Menüs» (Gruppen, Optionen, Zuordnung zu Artikeln). Bestellung: Artikel mit Gruppen führen in einen Auswahlschritt (`?artikel=<id>`), Sonderwunsch auch bei Artikeln ohne Gruppen. Offline-Kasse: gleiche Auswahl auf dem Gerät.
- Nicht in Etappe A: Optionen in CSV-Import, Mengenregeln je Option, Zutaten/Allergene.

**Etappe B: Küchenbildschirm im Browser**
- Jeder Artikel hat eine **Station** (`pos_items.station`: Küche, Bar oder keine; Standard Küche). Einstellbar unter Einstellungen → Gastronomie → Speisekarte.
- Seite **Küche** (`restaurant/kueche`, Bereich «kitchen», Reiter unter Heute → Restaurant; Rolle «Service» hat sie): offene Posten der gewählten Station (Küche/Bar), nach Bestellung gruppiert, älteste zuerst, mit Tisch, Wartezeit (ab 15 Min. hervorgehoben), Optionen und Sonderwunsch. Antippen einer Zeile oder «Alles fertig» meldet fertig; die Seite lädt alle 10 Sekunden neu.
- «Fertig» steht in `pos_line_done` (Zeile, Zeit, Person); Bestellzeilen bleiben unveränderbar. Stornierte Zeilen (Netto-Menge 0) und Posten älter als 1 Tag erscheinen nicht. Offline erfasste Bestellungen erscheinen nach der Übertragung.
- Nicht in Etappe B: Drucker (Bons), Gangfolge/Zurückhalten, Töne, eigene Küchen-Geräte-Anmeldung.

**Etappe C: Tischplan und Tischreservierungen**
- **Tischplan:** Tische haben Plätze (`seats`), Form (eckig/rund) und Lage im Plan (`plan_x`/`plan_y`, Promille der Fläche). Einrichtung unter Einstellungen → Gastronomie → «Tischplan» (`restaurant/tische`): eine Liste mit Plätzen, Form und «Im Plan» je Tisch, Tische per Maus oder Finger ziehen, ein Knopf «Änderungen speichern». Zeiten und Regeln der Online-Reservierung: «Reservierung»; Online-Bestellung: «Bestellung». Die Plan-Ansicht (Reservierungen → Tischplan) zeigt im Tisch nur Name, Plätze und eine Kurzzeile («frei bis 20:00», «bis 21:30»), Einzelheiten nach dem Antippen, Filter «ab n Plätze» blendet andere Tische ab. Farben: frei (grün), belegt oder nächste Reservierung in unter 30 Minuten (orange), am Tisch oder offene Bestellung (rot). Tische ohne Position erscheinen weiter in der Liste darunter, die auch zum Eröffnen dient.
- **Reservierungen** (`pos_reservations`: Tag, Zeit, Personen, Name, Telefon, E-Mail, Notiz, Tisch, Status bestätigt/am Tisch/storniert/nicht erschienen, Quelle intern/online, öffentlicher Token). Seite «Reservierungen» (Reiter unter Heute → Restaurant, Bereich `reservations`, Rolle Service): Liste je Tag mit Tag-Navigation, Tisch zuweisen (Kollision: derselbe Tisch nicht zweimal in der Dauer), Status, neue Reservierung. Intern darf überbucht werden.
- **Online für Gäste** (`restaurant_settings`, nur Manager, standardmässig aus): bis zu zwei Zeitfenster (Beginn im 30-Minuten-Raster), Dauer, Plätze online (Kapazität = gleichzeitig anwesende Gäste), grösste Gruppe, Vorlauf in Stunden, Vorschau in Tagen. Öffentliches Formular `/[sprache]/tisch` (Vorschau `/h/<slug>/[sprache]/tisch`): Datum und Personen → freie Zeiten → Name, E-Mail oder Telefon, Wünsche → Bestätigung. Server prüft Fenster, Vorlauf, Kapazität und Gruppengrösse erneut. Honigtopf-Feld gegen Bots; keine Anzahlung, keine Kartendaten.
- **Mail** `table_reserved` (5 Sprachen) mit Link zur Reservierung `/[sprache]/tisch/<token>`: ansehen und stornieren. Ohne E-Mail keine Mail. Der Slug `tisch` ist für Website-Seiten reserviert.
- Nicht in Etappe C: SMS-Erinnerung, Zusammenstellen mehrerer Tische.

**Etappe C2: Anzahlung als Garantie, Warteliste, Erinnerung, automatische Zuteilung**
- **Anzahlung** (Einstellung, standardmässig 0 = aus; setzt ein verbundenes Stripe-Konto voraus, sonst Fehler beim Speichern): Betrag je Person ab einer Gruppengrösse, nur bei Online-Reservierungen. Ablauf wie Gutschein/Upselling: `createPaymentCheckout` (Direct Charge auf dem Konto des Hotels, **keine Plattformgebühr**, `application_fee_amount` wird bei 0 nicht gesendet), Metadaten `reservation_id`. Die Reservierung ist bis zur Zahlung `pending` (hält die Plätze 35 Minuten, Stripe-Seite läuft nach 30 ab), danach `confirmed` mit `deposit_status=paid`; erst jetzt geht die Bestätigungsmail raus. Webhook: `checkout.session.completed` → `markReservationPaid` (idempotent); `expired`/`async_payment_failed` → `cancelUnpaid`. Kommt die Zahlung nach Freigabe, wird sie sofort zurückerstattet.
- **Storno:** Gast storniert über den Link: bis `cancel_hours` (Standard 24 h) vor Beginn wird die Anzahlung automatisch zurückerstattet, später bleibt sie beim Betrieb. Storniert der Betrieb, wird sie immer erstattet; «nicht erschienen» behält sie. Bezahlte Anzahlung steht in der Liste («bei der Rechnung abziehen»); keine automatische Verrechnung auf Bons.
- **Warteliste** (`pos_waitlist`): Ist online nichts frei, trägt sich der Gast mit Name und E-Mail ein. Sobald für seine Gruppe wieder ein Zeitpunkt frei ist (Storno, Freigabe, Job alle 5 Minuten), bekommt er einmal die Mail `table_waitlist` mit Link zum Formular; wer zuerst bucht, bekommt den Tisch. Der Betrieb sieht die Warteliste je Tag.
- **Erinnerung:** `reminder_hours` (Standard 24, 0 = aus) vor Beginn einmal die Mail `table_reminder` an Gäste mit E-Mail (Job `table-reservations`, alle 5 Minuten).
- **Automatische Zuteilung** (`auto_assign`, Standard an): beim Anlegen ohne Tischwahl der kleinste freie Tisch mit genug Plätzen; ohne passenden bleibt die Reservierung ohne Tisch. Knopf «Offene automatisch einem Tisch zuteilen» je Tag (grosse Gruppen zuerst). Kein Zusammenstellen mehrerer Tische.

**Etappe D: KI-Speisekarte**
- Auf der Restaurant-Seite (Einstellungen → Gastronomie → Speisekarte → «Speisekarte mit KI einlesen»), nicht unter Datenübernahme: die Übernahme der Speisekarte ist einmalig, die KI-Einrichtung gehört zur Einrichtung des Restaurants.
- Quelle: Adresse der Speisekarte (bis 5 Seiten derselben Domain mit passenden Stichwörtern wie speisekarte, menu, getränke) oder PDF (bis 4 MB, 12 Seiten). Gleiche **Kostenbremsen** wie die KI-Einrichtung (SPEC 19.36): nur nach Abo (Karte und Gastgeber-Bedingungen), Monatslimit **je Zweck** getrennt (`setup_imports.purpose` = hotel oder menu; Hotel-Läufe blockieren die Speisekarte nicht), Tageslimit über alle, begrenzte Textmenge, begrenzte Antwort (6000 Tokens), nicht erreichbare Quelle verbraucht keinen Lauf. Der gelesene Text wird nicht gespeichert.
- Ergebnis ist ein **Entwurf** (`{items:[{category,name,description,price}]}`, höchstens 150 Artikel; nur Artikel mit Preis grösser 0, doppelte entfernt). Der Betrieb sieht eine Tabelle, kann Häkchen wegnehmen und Kategorie, Name und Preis ändern, dann «Ausgewählte übernehmen»: Anlage über denselben Weg wie der CSV-Import (`importItems`, Artikel mit gleichem Namen und gleicher Kategorie werden übersprungen), **Standard-MWST-Sätze** (8,1 % im Haus, 2,6 % Take-away; die KI setzt keine Sätze), Station Küche. Der Entwurf lässt sich verwerfen; nach Übernahme werden die Entwurfsdaten gelöscht; doppelt übernehmen geht nicht.
- Nicht in Etappe D: Optionen/Menüs und Allergene aus der Karte lesen, mehrsprachige Karten, Bilder der Gerichte.

## 20. Restaurant als eigene Betriebsart (Konzept: Projekt `claude/Restaurant-Konzept.md`, Navigation: `claude/Navigation.md` Teil B)
Massgebend sind die Entscheide vom 21.11.2026 (Konzept Abschnitt 2). Offene Punkte stehen in `QUESTIONS.md` («Restaurant»). Anzahlung für Tischreservationen bleibt **gebührenfrei** (Entscheid Betreiber 21.11.2026).

### 20.1 R1: Betriebsart, Modul-Zuschnitt, Navigation mit zwei Bereichen
**Module.**
- Neu `restaurant` («Restaurant: Reservierung, Speisekarte, Küche», ohne Aufpreis, Standard aus, **braucht nicht** `invoicing`): Reservierungen inkl. Online, Warteliste, Erinnerung, Anzahlung; Tischplan; Speisekarte/Artikel mit Optionen, KI-Speisekarte, CSV-Import; Küchenbildschirm; Tagesübersicht; später Online-Bestellung (R3/R4).
- `pos` wird «Kasse» (CHF 29/Monat, Standard aus, braucht `restaurant` und `invoicing`): Tische/Bestellen am Tisch, Kasse (auch offline), Getrennt-Zahlen, Kassenabschluss, Kassen-Geräte, «aufs Zimmer».
- Migration: jeder Betrieb mit `pos` an bekommt `restaurant` an (Zeile in `hotel_modules`).
- Seiten prüfen das passende Modul: `restaurant` für Reservierungen, Tischplan, Warteliste, Tagesübersicht, Küche, Speisekarte (Artikel, Optionen, KI, CSV, Vorlage), Reservierung; `pos` für Tische, Bestellung, Kasse (inkl. Offline-API), Kassenabschluss, Kassen-Geräte, Export.
- Preis: der Betrag von `pos` ist Teil des Abos (Abo & Gebühren); die Abrechnung des Aufpreises ist nicht Teil von R1 (Anzeige «CHF 29/Monat» in der Beschreibung).

**Betriebsart.** `hotels.property_type` erlaubt zusätzlich `restaurant` («Restaurant / Café / Take-away»). «Weiteren Betrieb anlegen» bietet sie an; die öffentliche Registrierung nur mit `/registrieren?art=restaurant` (ASSUMPTION: Pilotbetriebe; pontivo.ch bleibt bis R7 auf Unterkünfte ausgerichtet, Konzept Entscheid 1). Start-Funktionen: `restaurant` an, `frontdesk`, `housekeeping`, `statistics`, `guests`, `groups` aus; Rest nach Standard. Kurtaxe, Zimmer und Channex gibt es für Restaurants nicht: Go-live-Prüfung ohne Kurtaxe/Zimmer/Preise, Grunddaten ohne Check-in/out und Kurtaxe.

**Gastro-Bezeichnung und Öffnungszeiten.** Neues Feld `hotels.dining_label` (feste Liste: `restaurant` Vorgabe, `cafe`, `bar`, `beiz`, `takeaway`, `kitchen`; Anzeige Restaurant, Café, Bar, Beiz, Take-away, Küche; mit EN/FR/IT). `restaurant_settings.opening_hours` (je Wochentag 0–6 bis zu drei Zeiträume `von–bis`; `null` = keine Einschränkung): Online-Reservierung bietet nur Zeiten an Tagen mit Öffnungszeit und innerhalb eines Zeitraums an (Ruhetage). Beides unter Grunddaten (bei Modul `restaurant`).

**Zwei Bereiche.** Bereiche heissen fest **Unterkunft** (`lodging`) und **Gastronomie** (`dining`).
| Betrieb | Navigation | Umschalter |
| --- | --- | --- |
| ohne Modul `restaurant` | Hotel-Baum (Teil A, ohne Reiter «Restaurant» unter Heute) | nein |
| `property_type = 'restaurant'` | Restaurant-Baum | nein |
| Unterkunft mit Modul `restaurant` | beide | ja, wenn die Person in beiden Bereichen mindestens einen Hauptpunkt sieht |

Restaurant-Baum (Schlüssel und Adressen der bestehenden Seiten bleiben):
```
Heute           Tagesübersicht (dininghome, restaurant/heute) · Posteingang (inbox)
Reservierungen  Liste (reservations) · Tischplan (resplan, restaurant/tischplan) · Warteliste (waitlist, restaurant/warteliste)
Bestellungen    Tische (restaurant) · Kasse (kasse) · Küche (kitchen)
Finanzen        Kassenabschluss (posclose) · Rechnungen (invoices) · Gutscheine (vouchers) · Buchhaltung (accountingexport)
Zahnrad         Betrieb: Betriebsdaten · Funktionen · Team & Rollen · Geräte (Kartenterminal, Zutritt) · Zahlungsmethoden · Abrechnung · Datenübernahme
                Unterkunft: Zimmer & Tarife · Zusatzleistungen · Angebote vor Ort · Gästeportal · Upselling · KI-Chat
                Verkauf: Website & Buchung · Kanäle · Gäste-Mails
                Gastronomie: Speisekarte · Tischplan · Reservierung · Bestellung · Kasse (Kassen-Geräte, Kassen-Schnittstelle)
```
- Ein Zahnrad für beide Bereiche: bei Unterkunft mit Gastronomie stehen die Punkte beider nebeneinander; reine Restaurants sehen keine Unterkunftspunkte (Zimmer & Tarife, Zusatzleistungen, Kanäle, Gästeportal, Upselling, Direktbuchung, Schnittstelle, Zutritt, Datenübernahme).
- ASSUMPTION: «Statistik» und «Tagesabrechnung Online» im Restaurant-Finanzen folgen mit R8 (die heutige Statistik ist zimmerbezogen).
- **Umschalter** in der Kopfzeile direkt nach dem Betriebsnamen, zweiteilig, nur Symbole Bett/Besteck, auf Desktop und Handy gleich; die Bezeichnung (links Betriebsart: Hotel, B&B, Ferienwohnung, Chalet, Gruppenhaus; rechts die Gastro-Bezeichnung) steht als Tooltip und Screenreader-Name. Die Bezeichnung wird nicht mehr in den Funktionen eingestellt (Standard der Betriebsart); der Bereich «Darstellung» entfällt. Farbakzent je Bereich (Linie unter der Kopfzeile). **Zahlen für Ungesehenes (Stand 22.11.2026):** Eine Zahl zählt, was nach dem letzten Öffnen der jeweiligen Liste durch diese Person eingegangen ist (Tabelle `user_seen`, Migration 0092; je Person, Betrieb und Art). Arten: `inbox` (neue Anfragen und Gästewünsche, Bereich Unterkunft, Menüpunkt «Heute»), `bookings` (direkt gebuchte, bestätigte Buchungen, «Buchungen»), `reservations` (Online-Reservierungen, «Reservierungen»), `orders` (Online-Bestellungen ohne unbezahlte/abgelaufene, «Bestellungen»). Selbst erfasste Reservierungen und Buchungen zählen nicht. Die Zahl steht am Menüpunkt (Desktop und untere Leiste) und, als Summe, am anderen Bereich im Umschalter; 0 erscheint nicht, ab 100 «99+». Eine Art zählt nur, wenn ihre Seite im Menü der Person steht (Rolle, Module). Öffnen der Liste setzt «gesehen» (`SeenMark`, Aktion `markSeenAction`) und lädt die Zahlen neu. **Mitteilungen nach Art und Person (Web-Push, Migration 0093):** Jede Mitteilung in `push_outbox` hat eine Art (`orders`, `reservations`, `bookings`, `inbox`, `other`), dieselben vier wie die Zahlen plus «Sonstiges» (Gutschein, Extras). Der Worker sendet nur an Geräte von Mitgliedern, die die Liste zur Art im Menü sehen (`src/domain/push-kinds.ts`, gleiche Regel wie bei den Zahlen) und die Art nicht abgestellt haben (`push_prefs`, je Person und Betrieb, unter «Mein Konto»; eine Wahl gibt nie Zugang zu etwas, das die Rolle nicht sieht). «Sonstiges» nur Inhaber und Manager. Neu: «Neue Reservierung» bei Online-Reservierungen (mit Anzahlung erst nach Zahlung), ohne Namen. Geräte ohne Mitgliedschaft bekommen nichts mehr. **Sammelmeldung:** Kommen im selben Versandlauf (Worker, jede Minute) mindestens zwei gleichartige «neue …»-Ereignisse (Bestellung, Reservierung, Buchung, Anfrage/Nachricht) für einen Betrieb, geht eine Meldung «n neue …» mit Link auf die Liste raus (`src/domain/push-group.ts`). Dringendes bleibt einzeln (Erinnerung «Bestellung wartet», Überbuchung, Storno, Sonstiges). Noch nicht: längeres Zeitfenster. Abnahme: `tests/unit/push-group.test.ts`, `tests/integration/push.test.ts`. Abnahme: `tests/integration/push.test.ts`. **Offene Aufgaben (gemeinsame Zahl je Betrieb):** zählt, was erledigt werden muss, unabhängig vom Ansehen: `inbox` (offene Anfragen und Gästewünsche, Menüpunkt «Heute»), `orders` (Online-Bestellungen im Status «neu», die auf Annahme warten, «Bestellungen»), `overdue` (überfällige Rechnungen, «Finanzen», nur mit Menüpunkt Debitoren). Eine Aufgabe verschwindet erst mit dem Erledigen. Anzeige am selben Platz wie «neu»: gefüllt (Akzentfarbe) = neu für diese Person, hat Vorrang; umrandet = offen für das Team, wenn nichts neu ist; Tooltip und Screenreader nennen beides («2 neu, 5 offen»). Gleiche Sichtbarkeitsregel wie bei «neu». Keine E-Mail-Variante (Betreiber 22.11.2026). Abnahme: `tests/unit/unseen.test.ts`, `tests/integration/unseen.test.ts`.
- **Bereich bestimmen:** Seiten, die nur in einem Baum stehen, legen den Bereich fest (so wechseln Links aus Mails und Push-Meldungen automatisch); geteilte Seiten (Posteingang, Rechnungen, Gutscheine, Zahnrad, Profil) bleiben im zuletzt gewählten Bereich. Letzter Bereich in einem Cookie je Person (`pv_area_<user>`), damit z. B. das Tablet im Restaurant im Restaurant öffnet. Die Startseite `/admin/<id>` leitet im Bereich Gastronomie (und bei reinen Restaurants immer) auf die Tagesübersicht um.
- **Rollen:** «Service» bekommt `dininghome`, `resplan`, `waitlist` dazu, landet auf der Tagesübersicht und sieht keinen Umschalter (hat keinen Hauptpunkt der Unterkunft). Eigene Rollen können die neuen Seiten wählen.
- **Hinweis in der Tagesliste** der Unterkunft (bei Modul `restaurant`): «Restaurant heute: N Reservierungen, M Gäste» mit Link in die Tagesübersicht.
- **Tagesübersicht (Gastronomie):** Reservierungen von heute nach Zeit (Gäste gesamt, noch erwartet, am Tisch), Warteliste heute, offene Tische mit Betrag (nur mit `pos`), Hinweise (keine Artikel, keine Tische, Online-Reservierung aus).
- **Seiten umgehängt:** Tischplan-Editor, Tische anlegen und Einstellungen der Online-Reservierung ziehen von «Restaurant» (Artikel) bzw. der Reservierungsliste auf die neue Zahnrad-Seite «Reservierung»; die Warteliste bekommt eine eigene Seite; der Tischplan mit Reservierungszustand eine eigene Seite unter Reservierungen (ohne Kasse: frei/reserviert).

**Einrichtungsassistent für Restaurants** (gleiche Seite `einrichten`, eigene Schritte, Reihenfolge nach Konzept 7a, siehe SPEC 20.3). Willkommensmail ohne Zimmer/Kurtaxe.

### 20.2 R2-Rest: Tisch reservieren auf der Website, ohne Kasse, Gästekartei
- **Ohne Kasse:** Reservierungen (intern und online), Tischplan, Warteliste, Erinnerung und Anzahlung brauchen nur das Modul `restaurant` (SPEC 20.1). Die Online-Reservierung gilt nur, wenn `restaurant` an **und** «Gäste können online reservieren» an ist (`tableReservationOnline`); sonst zeigt `/[sprache]/tisch` den Hinweis «bitte anrufen» und der Server lehnt Online-Reservierungen ab.
- **Website:** neuer Baustein «Tisch reservieren» (`reserve`: Überschrift, Einleitung; Datum und Personen → freie Zeiten auf `/[sprache]/tisch`). Ist die Online-Reservierung aus, bleibt er unsichtbar. Reine Restaurants: die Startseite entsteht mit Titelbild ohne Zimmersuche und dem Baustein «Tisch reservieren»; der feste Knopf auf dem Handy heisst «Tisch reservieren» und führt zu `/[sprache]/tisch` (nur wenn online an).
- **Gästekartei:** gleiche Kartei wie bei Hotelbuchungen (`guest_profiles`, je Betrieb und E-Mail; Modul `guestnotes`, bei reinen Restaurants von Anfang an an). Reservierungen mit E-Mail erscheinen in der Kartei mit **Restaurantbesuchen** (am Tisch oder bestätigt und vorbei) und letztem Besuch; Gäste nur aus Reservierungen kommen dazu. Ab 3 Besuchen steht **«Stammgast»** (berechnet, nicht gespeichert). In der Reservierungsliste: Stammgast, Tags und Notiz des Gastes; «Kartei» klappt Tags und Notiz zum Bearbeiten auf. Hinweis: Allergien nur als kurzer Hinweis für die Küche, keine Gesundheitsangaben. Reservierungen ohne E-Mail (nur Telefon) haben keine Kartei. Im Restaurant-Baum steht die Kartei als «Gäste» unter Reservierungen.

### 20.3 Selbst-Onboarding (Konzept 7a, Abnahmekriterium für R1 und R3/R4)
Ein neues Restaurant richtet sich ohne Betreiber ein. Reservation in ca. 20 Minuten live, Online-Bestellung (R3/R4) am gleichen Tag, sobald Stripe freigegeben ist.
- **Schritte (feste Reihenfolge, Fortschrittsanzeige, je mit Hilfetext):** 1 Angaben und Öffnungszeiten (Pflicht) · 2 Tische und Plätze (Pflicht; «Anzahl Tische × Plätze» legt «Tisch 1…n» an) · 3 **Reservation live schalten** (Pflicht; Zeitfenster, Plätze online, grösste Gruppe; stellt Website und Online-Reservierung sofort online, ohne Stripe; danach Link zum Kopieren und QR-Code) · 4 Speisekarte (Pflicht; KI, CSV oder von Hand; der KI-Entwurf wird erst nach Prüfung übernommen) · 5 Zahlungen (Stripe, freiwillig; Status sichtbar, Prüfung «meist 1–2 Werktage», blockiert nur Zahlungen) · 6 Weitere Funktionen (freiwillig; Kasse u. a.) · 7 Grundgebühr: Karte oder QR-Rechnung (Pflicht, wenn Mindestgebühr; 20.6) · Einbau auf eigener Website (nur «nur Buchungssystem»). Ab R3: Online-Bestellung, Gerät mit Selbstprüfung und Pflicht-Probebestellung.
- Es gibt für Restaurants keinen Schritt «Online gehen»: Schritt 3 schaltet Website und Reservierung live (Go-live-Prüfung für Restaurants nur: E-Mail des Inhabers bestätigt). Sind alle Pflichtschritte erledigt, gilt die Einrichtung als abgeschlossen (Hinweiszeile verschwindet).
- **Teilschritte einzeln live:** Reservation geht vor Online-Bestellung; nichts wartet auf alles. **Anzahlung erst nach Stripe-Freigabe** (`charges_enabled`): bis dahin wird online ohne Anzahlung reserviert, die Einstellung sagt das.
- **Checkliste «Bereit für den Betrieb»** im Heute der Gastronomie (Inhaber/Manager), offen solange etwas fehlt: Angaben (reines Restaurant), Tische, Reservation online, Speisekarte, Zahlungen (Stripe), Karte für die Grundgebühr (reines Restaurant), eigene Domain (freiwillig). Offene Punkte mit Link; was Pontivo nicht beschleunigen kann, mit Hinweis und Dauer (Stripe-Prüfung «in Prüfung, meist 1–2 Werktage»; Domain «bis 24 Stunden nach der Umstellung beim Anbieter»). Ab R3 kommen Online-Bestellung, Gerät und Probebestellung dazu.
- Abweichungen zum Konzept: Grundgebühr per Karte oder QR-Rechnung (20.6, entschieden); Sprache wird bei der Registrierung nicht abgefragt (Standard Deutsch, in den Betriebsdaten änderbar, bestätigt); Website-Vorlage aus Öffnungszeiten und Speisekarte befüllen folgt mit R5.

### 20.4 R3: Online-Bestellung mit Abholung (Modul `restaurant`, ohne `pos`)
**Einstellungen** (`online_order_settings`, Zahnrad → Verkauf → «Bestellung», Seite `restaurant/bestellung-einstellungen`, Schlüssel `ordersettings`): Abholung an/aus, Zeitraster (Standard 15 Min.), höchstens N Bestellungen je Zeitfenster, Vorlauf (Standard 20 Min.), Bestellschluss vor Schliessung (Standard 15 Min.), «Bar bei Abholung» (Standard aus), SMS an Gäste (Standard aus, weiterverrechnet). Bestellt werden kann nur innerhalb der **Öffnungszeiten** (Pflicht für Online-Bestellung).
**Artikel:** neu «online bestellbar» (Standard an), Beschreibung, Foto (Adresse aus den Website-Fotos) und **Allergene** (feste Liste der 14 deklarationspflichtigen Allergene nach LIV Anhang 6). Die Gästeseite zeigt Allergene je Artikel und den Hinweis «Fragen zu Allergenen: bitte anrufen».
**Live schalten nur wenn:** Öffnungszeiten gesetzt, mindestens ein online bestellbarer Artikel, Stripe freigegeben (`charges_enabled`; im Testbetrieb ohne Stripe genügt der Fake-Anbieter) und eine **bestandene Probebestellung** (empfangen, annehmen, «bereit» melden auf dem Bestellbildschirm). Fehlt etwas, nennt die Seite den Grund mit Link.
**Gästeseite** `/[sprache]/bestellen` (und `/h/<slug>/[sprache]/bestellen`): Speisekarte nach Rubrik mit Foto, Beschreibung, Allergenen, Optionen/Menüs (gleiche Prüfung `pos-options.ts`), Sonderwunsch; Warenkorb im Browser; Abholzeit aus freien Zeitfenstern («so bald wie möglich» = erstes freies); Name, Telefon (Pflicht), E-Mail (Pflicht bei Kartenzahlung); Zahlung: Karte/TWINT über Stripe Checkout (Direct Charge, `application_fee_amount` = 1,9 %) oder bar bei Abholung (wenn erlaubt). Ist die Online-Bestellung pausiert oder geschlossen: «Zurzeit keine Online-Bestellungen». Statusseite `/[sprache]/bestellung/<token>` lädt von selbst neu.
**Datenmodell:** `online_orders` (Nummer je Tag `A-001`, Art pickup/delivery, Status `pending_payment` → `new` → `accepted` → `ready` → `completed`, sonst `rejected`/`expired`/`cancelled`; Zahlung `card`/`cash`; Positionen als JSON mit vom Server gerechnetem Text, Preis und MWST-Satz Take-away; Abholzeit gewünscht und zugesagt; Gebühr 1,9 %; `is_test`). Erst **bei der Annahme** entsteht eine `pos_order` (Gerät `ONL`, Bezeichnung «Abholung 18:30 · A-012») mit den Zeilen (Snapshot) → sie erscheint im **Küchenbildschirm**; Kartenzahlung wird dabei als Bon (Zahlart Karte, unveränderbar, MWST 2,6 %) gebucht, Barzahlung beim Abschluss («abgeholt»). ASSUMPTION: Bon bei Annahme statt direkt nach der Zahlung, damit abgelehnte oder automatisch stornierte Bestellungen keinen Gegenbon brauchen.
**Bestellbildschirm** (`restaurant/bestellungen`, Schlüssel `onlineorders`, unter Bestellungen; Rolle Service hat ihn): neue Bestellungen mit **Daueralarm** (Ton, bis angenommen), Annehmen mit Zeit (wie gewünscht, +10, +20, +30 Min.), Ablehnen mit Grund (Karte wird zurückerstattet), «Bereit» (Mail, optional SMS an den Gast), «Abgeholt» (bar: Bon); Pause-Knopf (30 Min., 60 Min., bis morgen, fortsetzen); lädt alle 10 Sekunden neu; Push an alle Geräte des Betriebs bei neuer Bestellung.
**Absicherung (Konzept 7, Job `online-orders` jede Minute):**
- **Herzschlag:** jeder offene Bestellbildschirm meldet sich jede Minute (`order_screens`: Gerät, zuletzt gesehen, Akku, Ladekabel, Ton geprüft). Ist während der Öffnungszeit seit 3 Minuten kein Gerät erreichbar und die Online-Bestellung an, pausiert Pontivo sie automatisch (`auto_paused`, Gäste sehen «Zurzeit keine Online-Bestellungen») und schickt dem Inhaber SMS und Mail. Meldet sich ein Gerät wieder, endet die automatische Pause von selbst.
- **Selbstprüfung beim Öffnen:** Ton testen (Gerät bestätigt «gehört»), Warnung bei schwachem Akku (< 20 %) oder ohne Ladekabel (wo der Browser es meldet), Bildschirm wach halten (Wake Lock); Hinweis, dass ein stummes Gerät nicht erkannt werden kann.
- **Nicht angenommen:** nach 5 Minuten SMS (inklusive) und Mail an das Restaurant; nach 10 Minuten automatischer Storno mit voller Rückerstattung und Mail an den Gast.
- Nicht bezahlte Bestellungen verfallen nach 35 Minuten.
**SMS** über **ASPSMS** (JSON-API `SendTextSMS`, Zugang in `ASPSMS_USERKEY`/`ASPSMS_PASSWORD`, Absender `ASPSMS_ORIGINATOR`), Versand über `sms_outbox` (wie Mail-Outbox). Alarme an das Restaurant inklusive; SMS an Gäste nur wenn eingeschaltet, Anzahl je Monat auf der Plattformrechnung zum Selbstkostenpreis (`SMS_GUEST_PRICE_RAPPEN`). Ohne Zugangsdaten: nur Mail und Push (Meldung im Protokoll).
**Gebühr (Entscheid 21.11.2026):** vorerst **CHF 59 pro Monat** (Plattformeinstellung `order_fee_model` = `fixed`, Standard), keine Gebühr pro Bestellung. Verrechnet auf der Monatsrechnung (`platform_charges.order_module_rappen`, obendrauf, nicht an die Mindestgebühr angerechnet) für jeden Monat, in dem die Online-Bestellung beim Abrechnen eingeschaltet ist oder echte Bestellungen hatte. Grund: Plattformbesteuerung (Art. 20a MWSTG) bei umsatzabhängigem Entgelt ungeklärt, schriftliche Anfrage bei der ESTV am 21.11.2026. **Ziel:** 1,9 % auf jede Online-Bestellung (Modell `percent`; auch bar, bei Karte als `application_fee_amount`, bei Bar mit der Monatsrechnung), sobald die ESTV bestätigt, dass Pontivo keine Plattform im Sinne von Art. 20a ist; Umschalten in der Plattform-Verwaltung → Zahlungsverbindung nach Ankündigung an die Betriebe. **Kommunikation und Preis je Betrieb (Entscheid 21.11.2026, `src/domain/order-fee.ts`):** Normalpreis 1,9 % pro Bestellung. **Sonderangebot:** die ersten 3 Monate ab dem ersten Einschalten (`online_order_settings.started_on`, angefangener Startmonat zählt nicht) pauschal CHF 59 pro Monat, keine Gebühr pro Bestellung. **Pilotbetriebe:** die ersten 10 Betriebe, die einschalten, erhalten automatisch (`pilot_until`, Migration 0090) 12 Monate ab Start ein Kostendach von CHF 149 Gebühren pro Kalendermonat; die Gebühr einer Bestellung wird beim Anlegen so gekürzt, dass die Summe des Monats das Dach nicht übersteigt. Plattform-Admin kann den Status entziehen (Platz wird frei) oder vergeben (Zahlungsverbindung → Pilotbetriebe). Im Modell `fixed` zahlen alle die Pauschale unabhängig vom Startdatum (Sonderangebot faktisch verlängert); die Seiten zeigen trotzdem Normalpreis, Sonderangebot und Pilotplätze (Restaurant-Seite: Preistabelle, Abschnitt «Sonderangebot» mit freien Pilotplätzen, Frage; Einstellungen der Online-Bestellung: Stand des Betriebs). **Pilotbedingungen** (`src/legal/pilot-terms.ts`, Seite `/pilot-bedingungen`, Migration 0091): ergänzen die Bedingungen für Gastgeber; beim ersten Einschalten Pflicht-Häkchen, Version und Zeitpunkt in `online_order_settings.terms_version/terms_accepted_at`. Job `order-intro-notice` (täglich 08:35) schickt im Modell `percent` einmal ab 30 Tage vor Ende des Sonderangebots die Mail `host_order_intro_ending` (`intro_notice_at`). Probebestellungen ohne Gebühr, ohne Bon.
**Weiteres:** Website des Restaurants: fester Knopf «Online bestellen» (neben «Tisch reservieren»), sobald die Online-Bestellung eingeschaltet ist. Küchenbildschirm lädt ohne Neuladen der Seite neu und klingelt bei neuen Bons («Ton einschalten»). Checkliste «Bereit für den Betrieb» (Konzept 7a) hat den freiwilligen Schritt «Online-Bestellung» mit den fehlenden Punkten; die Tagesübersicht zeigt offene Online-Bestellungen und Bargeld je Fahrer. Pfade `bestellen` und `bestellung` sind für Website-Seiten reserviert.

### 20.5 R4: Lieferung
- **Liefergebiete** (`delivery_zones`): Name, Postleitzahlen (Liste), Mindestbestellwert, Liefergebühr, gratis ab Betrag, zusätzliche Minuten. Die PLZ bestimmt Gebiet und Gebühr; ausserhalb: «Wir liefern leider nicht nach …».
- **Adresse:** Strasse, Hausnummer, PLZ, Ort, Telefon Pflicht; Stockwerk, Klingelname, Hinweis freiwillig. **Vervollständigung** im Browser des Gastes über `https://api3.geo.admin.ch/rest/services/ech/SearchServer?type=locations&origins=address&limit=6&sr=4326&searchText=…` ab 3 Zeichen, 300 ms nach dem Tippen; «© Daten: swisstopo» beim Feld. Fällt der Dienst aus: von Hand eingeben, PLZ-Prüfung läuft auf dem Server. Fair Use (FAQ geo.admin.ch): 20 Anfragen pro Minute im 24/7-Mittel gelten als fair; erwartete Last weit darunter.
- **Lieferzeitfenster** mit eigener Kapazität (Fahrer), Lieferzeit = Küche + zusätzliche Minuten des Gebiets.
- **Bar bei Lieferung** (Standard aus): optional Höchstbetrag; Telefon Pflicht; Adressen mit früherer Nicht-Annahme werden im Bestellbildschirm markiert (`delivery_flags`, normierte Adresse). Der Fahrer kassiert; der Bon (bar) trägt den Fahrer, die Tagesübersicht zeigt Bargeld je Fahrer.
- **Liefergebühr** als eigene Zeile auf dem Bon (MWST wie Speisen 2,6 %; ASSUMPTION, vom Treuhänder zu bestätigen, `QUESTIONS.md`).
- **Fahrer-Ansicht** (neue Rolle `driver`, Seite `restaurant/fahrer`, Handy): angenommene und bereite Lieferungen mit Adresse, Telefon, Bezahlt/Bar mit Betrag, Link zur Navigation (Google Maps/Apple Karten); «Unterwegs» (Mail, optional SMS an den Gast), «Geliefert» (bar: Betrag bestätigen → Bon), «Nicht angenommen» (Adresse wird markiert).
- Nicht in dieser Stufe: fremde Kurierdienste, Live-Ortung, Tourenplanung.


### 20.6 Grundgebühr per Karte oder QR-Rechnung (Entscheid 21.11.2026, Konzept 6 und 7a Schritt 8)
- **Zahlungsart je Betrieb** (`hotels.billing_method`: `card` Standard, `qr`): Der Betrieb wählt im Assistenten (Schritt «Grundgebühr», bisher «Karte für die Grundgebühr») und unter Zahlungen → Grundgebühr. Erledigt ist der Schritt mit hinterlegter Karte **oder** gewählter QR-Rechnung. Wo bisher eine Karte Voraussetzung war (KI-Chat, KI-Einrichtung), genügt auch die QR-Rechnung (`billingReady`). Wechsel jederzeit; gilt ab der nächsten Monatsrechnung, bestehende Rechnungen behalten ihren Weg.
- **Monatsrechnung** wie 19.30 (gleicher Betrag `billMonth`). Weg `card`: unverändert. Weg `qr` mit Betrag > 0: Status `invoiced`, Fälligkeit = Rechnungsdatum + Zahlungsfrist (Plattform-Einstellung, Standard 30 Tage), Mail `host_invoice_qr` mit Link auf die Rechnung; die Druckansicht zeigt den **Zahlteil der QR-Rechnung** (Konto der Plattform; mit QR-IBAN Referenz `QRR` aus der Rechnungsnummer, sonst `NON` mit «Rechnung R-…»; Zahlbar durch = Betrieb mit Adresse). Ohne IBAN der Plattform entsteht die Rechnung ohne Zahlteil, und die Plattform-Verwaltung zeigt eine Warnung.
- **Mahnwesen** (Job täglich, gleiche Stufen wie Debitoren 19.7: 5, 20, 35 Tage nach Fälligkeit): Zahlungserinnerung, 1. Mahnung, 2. Mahnung als Mail `host_invoice_reminder` mit Stufe, Betrag, ursprünglicher Fälligkeit und neuer Frist (14 Tage, wie die Nachfrist in den Gastgeber-Bedingungen Ziffer 3); ab der 2. Mahnung Hinweis an die Plattform (`PLATFORM_ALERT_EMAIL`). ASSUMPTION: keine Mahngebühren, keine automatische Pause des Betriebs (entscheidet die Plattform-Verwaltung, Knopf «Pausieren» besteht).
- **Plattform-Verwaltung → Rechnungen:** Filter «offen» (QR, unbezahlt) mit Fälligkeit und Mahnstufe; Aktionen «Zahlung erfasst» (Datum, Notiz), «Mahnung jetzt senden» (nächste Stufe), «Rechnung erneut senden»; **Bankdatei camt.054** hochladen: Gutschriften mit QR-Referenz werden der Rechnung zugeordnet und als bezahlt markiert (Bankreferenz einmalig, `paid_ref`), nicht zuordenbare werden gemeldet. Neue Seite **Plattform → Zahlungsverbindung**: IBAN oder QR-IBAN (CH/LI, Prüfziffer), Zahlungsfrist (Tage); Gläubiger = `PLATFORM_OPERATOR`, `PLATFORM_ADDRESS`. Protokoll `platform.billing_changed`, `billing.qr_paid`, `billing.reminder`.
- **Datenmodell** (Migration 0086): `hotels.billing_method`; `platform_charges.method`, `due_date`, `paid_at`, `paid_ref`, `paid_note`, `dunning_level`, `dunned_at`; Status zusätzlich `invoiced`.
- Monatliche Rechnung auch beim Weg QR (entschieden 21.11.2026; keine Jahresrechnung).

### 20.7 R5: Website-Vorlage Restaurant (Konzept R5, 7a)
- **Eine Karte für alles:** Baustein «Speisekarte» mit Quelle `items` liest die aktiven Artikel (`pos_items`: Rubrik, Name, Beschreibung, Preis, Allergene) beim Anzeigen; Quelle `manual` wie bisher. Rubriken bleiben zusammen (Reihenfolge der ersten Nennung). Allergene je Gericht in der Sprache der Seite, darunter «Fragen zu Allergenen: bitte anrufen»; ist die Online-Bestellung an, Knopf «Online bestellen».
- **Öffnungszeiten** mit Quelle `opening` lesen die Öffnungszeiten der Betriebsdaten (gleiche wie Reservierung und Online-Bestellung); Betriebsferien und Hinweis bleiben im Baustein. Strukturierte Daten (schema.org/Restaurant) und KI-Wissen nutzen die gelesenen Daten.
- **Neuer Baustein «Online bestellen»** (`order`): Überschrift, Einleitung, Knopf zu `/[sprache]/bestellen`; unsichtbar, solange die Online-Bestellung aus ist (wie «Tisch reservieren»).
- **Vorlage beim Anlegen** eines Restaurants (Startseite): Titelbild ohne Zimmersuche, Tisch reservieren, Online bestellen, Öffnungszeiten (`opening`), Speisekarte (`items`), Lage (Adresse leer = immer die aktuelle des Betriebs). Damit ist die Website nach Schritt 1–4 des Assistenten ohne weitere Arbeit gefüllt. Bestehende Restaurant-Websites bleiben unverändert; die Bausteine lassen sich im Editor hinzufügen bzw. umstellen.
- Gleicher Baukasten und gleiche Layouts wie bei den Unterkünften; keine Sonderlösungen je Betrieb.

### 20.8 R8: Betrieb ohne Modul Kasse
- Website, Reservation, Online-Bestellung, Gutscheine und Anzahlungen hängen nicht vom Modul `pos` ab (Modul `restaurant` genügt). Online-Bestellungen nutzen im Hintergrund die Bon-Technik (19.16) über das System-Gerät `ONL`: lückenlose Nummern, unveränderbar, MWST je Satz.
- **Quittung an den Gast:** Die Statusseite der Bestellung zeigt nach der Zahlung die Quittung (Bon-Nummer, Zeitpunkt, Betrieb mit MWST-Nummer, MWST je Satz).
- **Tagesabrechnung der Online-Verkäufe** (Seite `restaurant/online-verkaeufe`, Schlüssel `onlinesales`, unter Finanzen; Rollen Inhaber/Manager/Mitarbeitende und Buchhaltung): je Geschäftstag Anzahl, Total, MWST je Satz (netto, Steuer), online bezahlt, bar, Plattformgebühr; Monat blättern, Druck («Als PDF speichern») und CSV (`…/online-verkaeufe/csv?month=JJJJ-MM`). Grundlage: Bons des Geräts `ONL` (Probebestellungen haben keinen Bon).
- **Buchhaltungsexport** (18.3, wenn eingeschaltet): je Tag ein Sammelbeleg `ONL-JJJJ-MM-TT` (Ertrag übrige Leistungen je MWST-Satz an Debitoren; Zahlung online an Konto Stripe, bar an Kasse).
- **Preis Kasse:** CHF 29 pro Monat (Konzept 6) auf der Monatsrechnung (`platform_charges.pos_module_rappen`, obendrauf wie die Pauschale der Online-Bestellung), wenn das Modul `pos` am Abrechnungstag eingeschaltet ist; keine Teilmonate.
- Das Modul `pos` schaltet nur den Verkauf im Lokal frei (Tische, Kasse, Getrennt-Zahlen, Kassenabschluss, Geräte). Hotel mit Restaurant ohne Modul: eigene Kasse bucht über PosBridge (19.15) aufs Zimmer.

### 20.9 R7: Öffentliche Seiten (Dachmarke, Unterkünfte, Restaurants)
Texte: Claude Docs «Pontivo Website-Texte: Startseite, Unterkünfte, Restaurants» (21.11.2026); Preise nach Restaurant-Konzept Abschnitt 6 und den Entscheiden vom 21.11.2026.
- **`/` Startseite der Dachmarke:** «Ihre Gäste direkt bei Ihnen. Ohne Umweg.», Weiche «Was führen Sie?» (Unterkunft, Restaurant, Beides), was alle Betriebe bekommen, Preisprinzip, Fragen, Gespräch vereinbaren. Domain eines Hotels leitet wie bisher auf dessen Website.
- **`/unterkunft`:** die bisherige Hotel-Startseite unverändert (Texte unter Plattform-Verwaltung → Website-Texte, Rechner, Funktionen).
- **`/restaurant`:** Hero mit Rechenbeispiel (400 Bestellungen à CHF 35: Lieferplattform ca. 13 % bzw. 30 % gegen 1,9 %, Quelle Beobachter), vier Bausteine, «Weil alles zusammenhängt», Preise (Grundgebühr CHF 19, Online-Bestellung 1,9 % mit Sonderangebot 3 Monate CHF 59 und Pilotplätzen, siehe 20.4; Gutscheine 1,9 %, Anzahlung ohne Gebühr, Kasse CHF 29, KI-Chat ab CHF 19), Abschnitt zum Wechsel von GloriaFood (verschwindet nach dem 30.04.2027 von selbst), Fragen, Gespräch vereinbaren. «Jetzt selbst einrichten» → `/registrieren?art=restaurant` (Restaurant-Texte im Formular).
- **Restaurant-Seite öffentlich (23.11.2026):** Die frühere Freischaltung (`platform_settings.restaurant_public`) ist entfernt. `/restaurant` ist immer öffentlich, die Startseite verlinkt Unterkunft, Restaurant und «Beides», «Restaurant» ist in der Registrierung immer wählbar. Der alte Eintrag in `platform_settings` bleibt ungenutzt in der Tabelle.
- Keine Konkurrenten auf den Seiten ausser dem sachlichen GloriaFood-Hinweis; Apple Pay/Google Pay werden nicht genannt, solange nicht geprüft ist, dass sie im Checkout aktiv sind. Statische Fassung (`scripts/export-static-site.mjs`) enthält `unterkunft.html` und, wenn öffentlich, `restaurant.html`.

### 20.10 R6: Verpachtetes Restaurant bucht aufs Zimmer (PosBridge zwischen zwei Betrieben)
Fall: Hotel und Restaurant sind verschiedene Firmen, also zwei Betriebe in Pontivo (Konzept Entscheid 4). Optional, nur wenn beide es wollen.
- **Hotel** (Modul `posbridge`, 19.15): erstellt unter «Kassen-Schnittstelle» einen Schlüssel (Zweck Kasse) und gibt ihn dem Pächter. Widerruf beendet die Verbindung sofort.
- **Pächter** (Modul `pos`): «Einstellungen → Gastronomie → Kasse → Kassen-Geräte» → «Hotel verbinden (aufs Zimmer)»: Schlüssel einfügen. Pontivo prüft ihn wie die Schnittstelle (gültig, Zweck Kasse, Modul beim Hotel an, nicht der eigene Betrieb) und speichert ihn verschlüsselt (`room_links`, AES-256-GCM wie 14.7, nur Präfix sichtbar). Höchstens eine aktive Verbindung.
- **Kein direkter Zugriff zwischen den Betrieben:** Alles läuft über die Funktionen der Schnittstelle mit dem Schlüssel des Hotels; das Hotel kommt immer aus dem Schlüssel.
- **Gäste im Haus:** neu `GET /api/v1/in-house` (Zweck Kasse): Buchungsnummer, Zimmer, Name als «Nachname V.» der Gäste von heute (Datensparsamkeit). Die Kasse des Pächters zeigt diese Liste bei «aufs Zimmer» (auch offline aus dem letzten Abruf).
- **Bezahlen «aufs Zimmer»:** Ist die Buchungsnummer keine eigene und eine Verbindung aktiv, bucht Pontivo je Bon-Zeile (und Trinkgeld) einen Posten auf die Hotelrechnung (`external_id` = `pontivo:<Bon-Id>:<Position>`, damit idempotent; Text «… (Restaurant <Name> <Bon>)»; MWST-Art `standard`, bei 0 % `none`). Der Bon des Pächters trägt Zahlart `room` mit Verbindung und Buchungsnummer des Hotels. Scheitert die Buchung beim Hotel: online Fehlermeldung, nichts gebucht; offline übertragene Bons bleiben «ohne Zuordnung» (Kassenabschluss) wie bisher.
- **Gegenbon:** bucht die Posten beim Hotel mit negativer Menge zurück (eigene `external_id` mit `:rev`).
- **Abrechnung zwischen den Firmen:** Pächter sieht je Monat die Summe «aufs Zimmer» an das Hotel (für seine Rechnung an das Hotel), das Hotel unter «Kassen-Schnittstelle» je Schlüssel und Monat die gebuchten Beträge. ASSUMPTION: Posten laufen auf der Hotelrechnung mit dem Standard-MWST-Satz des Hotels; ob sie als durchlaufender Posten ohne MWST des Hotels laufen müssen, klärt der Treuhänder (`QUESTIONS.md`).
### 19.50 Bedienmuster: Info-Symbol, Seitenleiste, Export-Knopf
- **Info-Symbol** (`InfoTip`): längere Erklärtexte unter dem Titel stehen hinter einem ⓘ (Tippen oder Klicken öffnet eine Karte, Esc, ✕ oder Tippen daneben schliesst; Maus, Touch und Tastatur). Mit Titel neben dem Symbol am Titel, sonst als Knopf «Worum geht es hier?». Kurze Legenden und Zahlen (z. B. Kalender, Tischplan) bleiben sichtbar.
- **Seitenleiste statt Formularkarten:** Zimmerplan («Zimmer verwalten», `?room=<id>|neu`: Typ, Nummer, Etage, Notiz, Sperren, Löschen; Typwechsel nur ohne zugewiesene Buchungen), Reinigung (Mangel/Auftrag), Buchungen («Buchung erfassen», `?neu=1`; `/bookings/new` leitet weiter) und Angebote vor Ort. Stammdaten der **Angebote vor Ort** stehen unter Einstellungen → Betrieb (`/resources/angebote`, Liste, Bearbeiten in der Seitenleiste, «+ Neues Angebot» zuunterst); Buchen und Tagesliste bleiben unter Buchungen → Angebote vor Ort.
- **Export einheitlich:** Jeder Download (CSV, Excel, ZIP, Vorlage) ist ein `DownloadLink` (Symbol + Text, umrandet; der Hauptexport einer Karte gefüllt). Exporte stehen unter der Tabelle bzw. am Ende der Karte, nicht in der Kopfzeile.

### 19.51 Shop & Lager (Modul `shop`, Etappe 1)
- **Zweck:** Waren mit Preis, optionalem Lagerbestand und (nur bei Betrieben mit Unterkunft) Minibar-Zuweisung. Tabelle `goods` (getrennt von `pos_items`). Modul `shop`, abhängig von `invoicing`, standardmässig aus; Seite `/admin/<id>/shop` (Einstellungen → Verkauf), Rolle Manager.
- **Felder:** Name, Kategorie, Preis (Rappen), MWST (Normalsatz | reduziert 2,6 % | ohne), verkäuflich, aktiv, Minibar + Sollmenge (1–99, gleich für alle Zimmer), Lager führen, Bestand, Mindestbestand.
- **Reine Restaurants** (`propertyType = restaurant`): keine Minibar-Felder; ein gesendeter Minibar-Wert wird verworfen.
- **Nachbestellen:** Ware mit Lager, aktiv und Bestand ≤ Mindestbestand. Wareneingang/Korrektur als Zahl, im `audit_log`.
- **Aufs Zimmer buchen:** in der Buchung (Rechnung & Kasse) «Ware aus dem Shop»: ein `folio_items`-Posten (Name, Preis, MWST als Kopie, `source = shop:<id>`), Bestand sinkt in derselben Transaktion. ASSUMPTION: Bestand darf unter 0 fallen. Reduzierter Satz: 2,6 % (ASSUMPTION: Alkohol und Non-Food gehören auf Normalsatz).
- **Minibar zählen (Etappe 2):** In der Seitenleiste eines Zimmers (Reinigung) erscheint «Minibar zählen», wenn Modul `shop` an ist, der Betrieb kein reines Restaurant ist und Minibar-Waren existieren. Je Ware die vorhandene Menge (Vorgabe = Sollmenge); Fehlendes (Soll − vorhanden) wird als Posten (`source = minibar:<id>`) der Buchung belastet, deren Aufenthalt vor dem Tag begann, den Tag erreicht und am frühesten endet (ASSUMPTION); ohne solche Buchung Fehlermeldung. Bestand sinkt wie beim Verkauf.
- **Nachfüllen (Etappe 3):** Jede Zählung mit Fehlmenge legt je Ware einen offenen Posten in `minibar_refills` an (ersetzt einen früheren offenen Posten derselben Ware im Zimmer). Die Reinigung zeigt oben «Minibar nachfüllen» (Zimmer, Mengen); «Aufgefüllt» erledigt alle Posten des Zimmers. Beide im `audit_log`.
- **Später:** Shop-Kasse am Empfang (Waren direkt kassieren, ohne Buchung). Online-Shop ist ausserhalb des Umfangs.
- **Abnahme:** `tests/integration/goods.test.ts`, `tests/e2e/shop.spec.ts`.
- **Posten buchen (Vereinfachung):** Alle Posten in `folio_items` entstehen über `insertFolioItem` (`src/services/folio.ts`): Rechnung & Kasse, Shop, Minibar, Angebote vor Ort, Kasse und Kassen-Schnittstelle. Geprüft durch `tests/unit/folio-single-entry.test.ts`.
- **Stammdatenlisten (Vereinfachung):** Seitenleiste (`components/admin/Drawer.tsx`: `Drawer`, `DrawerActions`) und Listenzeilen (`RowList`) sind gemeinsame Bausteine für Zimmerplan, Angebote vor Ort und Shop & Lager; neue Stammdatenseiten verwenden sie.
- **Zugriff (Vereinfachung):** Seiten und Server Actions einer Funktion prüfen Mandant, Rolle und Modul mit `requireHotelModule(modul, hotelId, rolle, bereich?)` (`src/auth/guard.ts`); `requireHotel` allein gilt für Seiten ohne Modul. Geprüft durch `tests/unit/guard-helper.test.ts`.

### Registrierung mit Passwort und Aktivierungslink
- Das Registrierformular verlangt ein Passwort (mindestens 8 Zeichen, gehasht gespeichert). Die Willkommensmail enthält einen **Aktivierungslink** (`/api/auth/activate`, `login_tokens.purpose='activate'`, 3 Tage gültig, einmalig): Er bestätigt nur die E-Mail-Adresse (`users.email_verified_at`) und meldet **nicht** an; danach Anmeldung mit E-Mail und Passwort oder Passkey (Einrichtung unter «Mein Konto»). Ein Aktivierungslink gilt nicht als Login-Link und umgekehrt. Ohne Passwort (Altaufrufe von `registerHost`) bleibt der bisherige Anmelde-Link. Bestehendes Konto: wie bisher ein Login-Link, gleiche Antwort. Abnahme: `tests/integration/register-password.test.ts`, `tests/e2e/onboarding.spec.ts`, `tests/e2e/mfa.spec.ts`.

- **Mehrfachauswahl als Kacheln:** Optionen in `.weekdays` (Checkbox/Radio) erscheinen als Kacheln, gewählt = Akzentfarbe (Wochentage, Sprachen, Bereiche, Zimmer, Ernährung). Wochentage über `components/admin/WeekdayPick.tsx` (sieben Kacheln, Kurzwahl «Alle / Wochenende / Keiner», Live-Hinweis «Nur Sa, So» / «Jeder Tag»; keiner gewählt = jeder Tag).

### Aussehen der Zahlungsseite (Stripe-Branding)
- Auf `/admin/<hotel>/zahlungen` (Inhaber, mit Stripe-Konto, Zahlungsanbieter Stripe) übernimmt der Knopf «Auf Stripe übernehmen» Logo und Hauptfarbe aus «Website & Buchung» (`hotels.content.brand`) auf das Stripe-Konto des Betriebs (`src/integrations/stripe/branding.ts`): Accounts v2, `configuration.merchant.branding` mit `primary_color` und `secondary_color` (= Hauptfarbe, ohne Farbe `#2f5d50`), `logo` immer, `icon` nur bei quadratischem Logo ab 128 × 128 Pixel; Bilder als Datei (Zweck `business_logo` / `business_icon`) im Namen des Kontos hochgeladen. Keine eigene Eingabe. Eintrag im `audit_log` (`stripe.branding`). Stripe-Doku: https://docs.stripe.com/api/v2/core/accounts/update. Abnahme: `tests/integration/stripe-branding.test.ts`, `tests/unit/image-size.test.ts`.

### Aussehen der Zahlungsseite (Stripe-Branding)
- Auf `/admin/<hotel>/zahlungen` (nur Inhaber, nur mit Stripe-Konto) übernimmt der Knopf «Auf Stripe übernehmen» Logo und Hauptfarbe aus «Website & Buchung» (`hotels.content.brand`) auf das Stripe-Konto des Betriebs (`configuration.merchant.branding`: `logo`, `primary_color`, `secondary_color`; `icon` zusätzlich, wenn das Logo quadratisch und mindestens 128 × 128 Pixel ist). Ohne Farbe gilt `#2f5d50`. `audit_log`: `stripe.branding`. Es gibt keine eigene Eingabe. Abnahme: `tests/integration/stripe-branding.test.ts`, `tests/unit/image-size.test.ts`.

### 19.52 Payment Element (Zahlung im Formular der Hotel-Website)
Entscheid 25.11.2026: Dritte Zahlungsvariante neben gehostetem und eingebettetem Checkout, mit voller Gestaltung (Farben, Schrift, Rundung, Dunkelmodus aus dem Design des Hotels). Die beiden anderen bleiben unverändert als Rückfall.
- **Einstellung:** `hotels.content.payment.ui` = `hosted` | `embedded` | `element` (Admin → Zahlungen, nur Inhaber, nur mit `STRIPE_PUBLISHABLE_KEY`). Fehlt `ui`, gilt das ältere `embedded`, sonst `hosted`. Gilt nur für die Buchungsstrecke der Pontivo-Website (`POST /api/bookings`); API v1 und das Widget für fremde Websites bleiben bei Checkout.
- **Zahlung:** PaymentIntent als Direct Charge auf dem Konto des Hotels, `application_fee_amount` wie beim Checkout, `automatic_payment_methods` (Zahlarten aus den Stripe-Einstellungen des Hotels), TWINT wird ausgeschlossen, wenn nicht aktiv oder Betrag über CHF 5'000. Metadaten `booking_id`, `hotel_id`, `reference`, `flow=element`. Idempotenzschlüssel `pi-<Buchung>`. `payments` bekommt eine Zeile mit `stripe_payment_intent_id` und ohne Checkout-Session.
- **Bestätigung:** nur durch den Webhook `payment_intent.succeeded` (nur mit `flow=element`, sonst würde eine Checkout-Zahlung doppelt gebucht), nie durch die Rückkehrseite. Gleiche Logik wie beim Checkout (`settleBooking`: bestätigen; kam die Zahlung nach Ablauf und das Zimmer ist weg → volle Rückerstattung, SPEC 5.4). `payment_intent.payment_failed` tut nichts (der Gast darf im selben Formular erneut versuchen). `payment_intent.canceled` gibt die Reservierung frei.
- **Ablauf:** Ein PaymentIntent läuft nicht von selbst ab. Gibt Pontivo eine Reservierung frei, bricht es offene PaymentIntents ab (`cancelPendingIntents`, nach dem Commit, wirft nie). Schlägt der Abbruch fehl (Stripe nicht erreichbar), holt der Minuten-Job ihn nach (`sweepIntents`, 2 Tage). Läuft die Zahlung schon (`processing`) oder ist bezahlt, lässt sich nicht abbrechen: der Webhook regelt es als späte Zahlung, und ein Alarm meldet «Zahlung läuft trotz abgelaufener Reservierung».
- **Formular** (`components/public/PaymentElementForm.tsx`): Stripe.js `elements({ clientSecret, appearance })`, `confirmPayment` mit `redirect: "if_required"`. Aussehen aus den CSS-Variablen der Seite (`--brand`, `--surface`, `--ink`, `--danger`), Thema «night» bei dunklem Grund. Abgefangen: Stripe.js lädt nicht oder braucht über 20 s (Werbeblocker) → Hinweis und «Erneut versuchen»; `loaderror`; Karte abgelehnt (Text von Stripe in der Sprache des Gasts); Netzfehler; Antwort nach 60 s nicht da → Hinweis «nicht nochmals bezahlen», «Stand prüfen»; Reservierung abgelaufen; Doppelklick; 3-D-Secure und TWINT (Weiterleitung bzw. QR) über `return_url`.
- **Rückkehr** (`/b/<Token>?paid=1`, bei Weiterleitung mit `redirect_status`): Die Seite wartet auf den Webhook (aktualisiert sich). Bei `redirect_status=failed` (TWINT abgebrochen oder abgelaufen) Hinweis und das Zahlungsformular erneut.
- **Zahlung fortsetzen:** `POST /api/bookings/<Token>/pay` liefert für eine noch reservierte Buchung den Stand des PaymentIntent (`open` mit `client_secret`, `processing`, `paid`, `gone`); `components/public/ResumePayment.tsx` zeigt auf der Buchungsseite das Formular erneut oder wartet auf die Bestätigung. Der Buchungslink ist das Geheimnis, Ratenbegrenzung 30 pro Minute und IP.
- **Abgleich** (nachts, `reconcile.ts`): prüft auch PaymentIntents ohne Session.
- **Webhook-Ereignisse zusätzlich abonnieren:** `payment_intent.succeeded`, `payment_intent.canceled`, `payment_intent.payment_failed` (README, `docs/deploy/2-dienste.md`).
- ASSUMPTION: Systemschrift des Hotels im Formular (eigene Webfonts brauchen Stripe `fonts`/`cssSrc`); kein automatischer Wechsel auf gehostetes Checkout im laufenden Vorgang (Checkout verlangt mindestens 30 Minuten Gültigkeit, die Reservierung hat dann weniger).
- Abnahme: `tests/integration/payment-element.test.ts`. Testlauf gegen Stripe-Testmodus (Karten 4242…, 4000 0000 0000 9995 abgelehnt, 4000 0025 0000 3155 3-D-Secure, TWINT-Testzahlung) siehe QUESTIONS.md.
- **Zahlarten und Domains per API (Nachtrag 26.11.2026):** Pontivo trägt die Domains des Hotels (eigene Domain und Pontivo-Adresse, nie `localhost`) im Stripe-Konto des Hotels ein (`POST /v1/payment_method_domains` mit Header `Stripe-Account`, Stripe-Doku «Register domains for payment methods»; Apple Pay braucht das bei Formular und eingebettetem Checkout, gehostet nicht) und schaltet Apple Pay, Google Pay und TWINT dort ein oder aus (Payment Method Configurations API, `display_preference.preference`; `available` nur, wenn auch die Fähigkeit aktiv ist, TWINT-Fähigkeit wird beim Anlegen des Kontos angefragt). Admin → Zahlungen → «Zahlarten bei Stripe» (nur Inhaber): drei Schalter, Stand der Domains je Apple und Google, «Domains neu eintragen und prüfen». Beim Wechsel auf «Im Formular» oder «Eingebettete Stripe-Seite» werden die Domains automatisch eingetragen. Ein Fehler bei Stripe blockiert die Seite nie (6 s Zeitgrenze, Hinweis). Code: `src/integrations/stripe/payment-methods.ts`, Abnahme `tests/integration/payment-methods.test.ts`.
- ASSUMPTION: Die Konfiguration des Hotelkontos wird mit `list({ application: <Plattform-ID> })` und Header `Stripe-Account` gelesen, die Standardkonfiguration (`is_default`) wird geändert. Domains werden beim ersten Eintrag nicht per Datei bei Apple bestätigt (Stripe erledigt das bei der Anlage, `validate` holt Verzögerungen nach). Ändert das Hotel später seine Domain, muss «Domains neu eintragen» gedrückt werden.

## 19.53 Tischplan: Räume, Elemente, Stühle, Reservierungen daneben

- **Räume** (`pos_areas`, z. B. Hauptsaal, Terrasse): jeder Raum hat seinen eigenen Plan, in der Ansicht und im Editor schaltet man per Tab um. Ohne Eintrag gibt es «Innenbereich». Löschen verschiebt die Tische in den ersten übrigen Raum (ohne Platz im Plan), Elemente werden gelöscht; der letzte Raum bleibt.
- **Elemente** (`pos_plan_items`): WC, Bar, Garderobe, Eingang, Küche, Treppe, Wand, Pflanze, Text; frei platzier- und skalierbar, mit optionaler Beschriftung.
- **Tische** sind eckig, länglich (`rect`) oder rund. Um jeden Tisch stehen Stühle (Anzahl = Plätze) in der Zustandsfarbe: grün frei, orange reserviert/bald, rot besetzt. Stühle lassen sich ausblenden.
- **Reservierungen** des Tages stehen neben dem Plan; Antippen einer Reservierung wählt ihren Tisch (und schaltet den Raum um), Antippen eines Tisches markiert seine Reservierung.
- Speichern des Layouts je Raum in einer Transaktion mit `audit_log`. Reine Logik in `src/domain/floorplan.ts`, DB in `src/services/floorplan.ts`.

## 19.54 Kellner und Zeitregler im Tischplan

- **Kellner** (`pos_waiters`: Name, Farbe) sind keine Benutzerkonten; Tische bekommen sie über `pos_tables.waiter_id` (Einstellungen → Tischplan). Auf dem Plan zeigt der Tisch die Initialen in der Farbe des Kellners; die Auswahl «Kellner» blendet die übrigen Tische ab. Entfernen setzt die Zuweisung seiner Tische zurück.
- **Zeitregler:** «Belegung um HH:MM» (09:00–23:30, 15 Minuten) berechnet Tischfarbe, Stühle und Kurzinfo im Browser aus den Reservierungen des Tages (`tableView`); offene Kassen-Bestellungen zählen als besetzt.

## 19.55 Tisch-QR: Bezahlen am Tisch, Trinkgeld, Bewertung

- Jeder Tisch hat einen QR-Token (`pos_tables.qr_token`); Seite `/<locale>/am-tisch/<token>` (auch unter `/h/<slug>/…`). Sie zeigt die offenen Posten der Kassen-Bestellungen des Tisches, der Gast wählt Mengen (Getrennt-Zahlen), Trinkgeld (kein, 5, 10, 15 %, eigener Betrag) und zahlt über Stripe Checkout (TWINT, Karte, Wallets) auf dem Konto des Betriebs.
- Der Vorgang steht in `table_payments` (Posten, Trinkgeld, Kellner des Tisches, Status). Nach dem Webhook `checkout.session.completed` (Metadaten `table_payment_id`) entsteht der Bon über `pay()` auf dem Gerät «QR»; Zahlart `card`, Trinkgeld im Bon. Sind die Posten inzwischen anders bezahlt, wird die Zahlung zurückerstattet (`status = failed`).
- **Bewertung** (`table_feedback`, einmal je Zahlung): 1–5 Sterne und Kommentar; ab 4 Sternen der Link zu Google (`restaurant_settings.review_url`), darunter bleibt die Rückmeldung intern.
- Keine Plattformgebühr auf diese Zahlungen (Verkauf vor Ort). Sprachen de, en, fr, it, nl.
- Noch nicht: Menü und Bestellen am Tisch per QR, Trinkgeld-Auswertung je Kellner, Bewertungs-Auswertung in der Oberfläche.

## 19.56 Auswertung Restaurant

- Seite `restaurant/auswertung` (Reiter «Auswertung» unter Finanzen, Rolle `manager`), je Monat: Umsatz und Trinkgeld gesamt, je Kellner und je Tisch (aus den Bons), durchschnittliche Verweildauer (Eröffnung der Bestellung bis letzter Bon, Bestellungen über 8 Stunden zählen nicht), Gäste je Stunde aus den Reservierungen, No-show-Quote, Bewertungen (Durchschnitt, kritische Kommentare ab 3 Sternen abwärts).
- Reine Logik `src/domain/dining-stats.ts`, Abfrage `src/services/dining-stats.ts`. ASSUMPTION: Kellner und Tische nach heutiger Zuweisung, nicht nach dem Stand zum Zeitpunkt des Bons.

## 19.57 Vorbestellung zur Reservierung (auch Gruppen)

- Einstellungen → Reservierung: «Vorbestellung zulassen» und «Pflicht ab Personen» (0 = nie; `restaurant_settings.preorder_enabled`, `preorder_required_from`). Nur online und nur mit freigegebenem Stripe-Konto.
- Auf der Reservierungsseite wählt der Gast nach der Zeit Mengen aus der Online-Speisekarte (Artikel, die «online» bestellbar sind und **keine Pflicht-Optionen** haben). Preise zum Zeitpunkt der Buchung, MWST-Satz «im Haus» (nur bei MWST-pflichtigem Betrieb, sonst 0).
- **Vorauszahlung:** Die Summe der Vorbestellung ist die Anzahlung (ersetzt die Anzahlung je Person) und wird über den bestehenden Anzahlungsweg bezahlt (Stripe Checkout, Status `pending` bis bezahlt, Verfall nach 35 Minuten). Storno rechtzeitig (Regel «Gratis-Storno bis») erstattet sie, «nicht erschienen» behält sie.
- **Platzieren:** Setzt das Personal die Reservierung auf «am Tisch» (oder weist danach den Tisch zu), entsteht einmalig eine Bestellung am Tisch (Gerät «RSV»; Küche sieht die Zeilen) und ein Bon über den Betrag (Zahlart Karte). Ohne Tisch bleibt die Vorbestellung in der Liste sichtbar (Reservierungen → Liste).
- Abnahme: `tests/integration/preorder.test.ts`, `tests/e2e/preorder.spec.ts`.

## 19.58 Tische zusammenlegen

- Eine Reservierung kann mehrere Tische belegen (`pos_reservations.extra_table_ids`, `table_id` bleibt der Haupttisch). Von Hand: in der Reservierungsliste zweiter Tisch «+ Tisch» (höchstens 4 Tische je Reservierung); alle Tische müssen zur Zeit frei sein, jeder belegte Tisch ist für andere Reservierungen gesperrt (`tableFree`).
- Automatisch (Einstellung «Tische zusammenlegen», `restaurant_settings.combine_tables`, Standard aus): passt kein einzelner Tisch, legt `suggestCombination` bis zu 4 freie Tische im selben Raum zusammen, ausgehend von einem Anker jeweils der nächste nach Lage im Plan; möglichst wenige Tische, dann möglichst wenige Plätze. Gilt für Online-Reservierung und «Tische automatisch zuteilen» des Tages.
- Der Plan zeigt die Reservierung an allen ihren Tischen (Farbe, Kurzinfo) und markiert alle beim Antippen; die Liste neben dem Plan nennt «T1 + T2».
- Noch nicht: zusammengelegte Plätze sind die Summe der Einzeltische (keine Abzüge), Kasse-Bestellung hängt am Haupttisch.


## 19.59 Online-Buchung steuern (Raum/Tisch) und Küchentakt

- Je Raum (`pos_areas.online`) und je Tisch (`pos_tables.online`) lässt sich festlegen, ob er online buchbar ist (Standard: ja). Ein Tisch ist online buchbar, wenn Tisch und Raum freigegeben sind (`onlineTableAvailable`). Online-Reservierungen erhalten nur solche Tische; ist keiner frei, wird die Zeit nicht angeboten und die Buchung abgelehnt. Das Personal kann in der Oberfläche weiterhin jeden Tisch zuweisen.
- **Küchentakt** (`restaurant_settings.slot_max_guests`, 0 = aus): Höchstzahl Gäste, die zur selben Uhrzeit neu beginnen. Ist sie erreicht, wird die Zeit online nicht mehr angeboten (`onlineSlots`).
- Abnahme: `tests/unit/floorplan.test.ts`, `tests/integration/floorplan.test.ts`.
