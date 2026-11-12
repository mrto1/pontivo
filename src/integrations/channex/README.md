# Channex (Meilenstein M3)

Noch nicht gebaut. Bereits vorhanden:

- Outbox: Jede Änderung an `inventory_days` / `rates_days` schreibt einen Eintrag in `channex_outbox` (siehe `src/services/outbox.ts`).
- Webhook-Endpoint `POST /api/webhooks/channex` mit HMAC-Prüfung (`signature.ts`).

Zu bauen (SPEC 7): `client.ts` (REST mit `user-api-key`), Worker `channex-outbox` (Bündeln, Token-Bucket 10/min pro Property und Art, Backoff),
Worker `channex-feed` (Feed lesen, Revisionen nach SPEC 5.6 verarbeiten, nur nach Erfolg acken), Admin-Aktion „Channex verbinden“.

## Webhook einrichten (getestet auf Staging, 10.11.2026)

`node --import tsx scripts/channex-webhook.ts [URL] [--new-key]` legt einen Signierschlüssel (`POST /signing_keys`, Geheimnis nur einmal sichtbar)
und einen globalen, signierten Webhook (`event_mask: "booking"`, `send_data: false`, `is_signed: true`, `signing_key_id`) an.
Channex sendet `x-hmac-timestamp`, `x-hmac-signature-256` (und `x-hmac-keys-256`). Test: neue Buchung und Stornierung über die
Channex-CRS-API → Webhook → Feed → Import und Ack innerhalb weniger Sekunden, Verfügbarkeit danach zurück an Channex.

## Zertifizierung (Stand 10.11.2026)

- Kalender: «Preise und Regeln setzen» speichert mehrere Zeilen (Ratepläne/Zeiträume) in einer Transaktion → ein einziger `POST /restrictions`.
- Vollabgleich (Einschalten oder Knopf) = genau ein Request je Art über den ganzen Horizont (548 Tage); neue Properties mit `state_length: 730`.
- Jede Übertragung speichert die Channex-Task-ID (`channex_outbox.task_id`), sichtbar im Admin unter Channex → «Letzte Übertragungen».
- Kein zeitgesteuerter Vollabgleich; nur Änderungen werden gesendet. Rate-Limit: höchstens 10 Requests/Minute je Property und Art, bei 429 Backoff.

## Booking.com im Admin verbinden (Channel API)

Seite `/admin/<id>/channex/booking`, Logik in `channels.ts` (Ablauf) und `booking-mapping.ts` (Zuordnung, ohne I/O).
Ablauf nach dem Channex-Leitfaden «Booking.com»: `test_connection` → `mapping_details` + `connection_details` (Entwurf in `channex_channels`)
→ Zuordnung → `POST /channels` (inaktiv; `group_id` aus `GET /properties/{id}`, in `hotels.channex_group_id` gespeichert)
→ `check_readiness` → `activate` → `execute/load_future_reservations`. Ändern der Zuordnung: `PUT /channels/{id}` mit allen `rate_plans`.
Aktivieren nur bei eingeschaltetem Abgleich. Staging-Testhotels: 5868189 (OBP), 6519420 (Standard); Testverbindung danach entfernen.

## Airbnb im Admin verbinden

Seite `/admin/<id>/channex/airbnb`, Logik in `airbnb.ts`. `POST /meta/airbnb/connection_link` (group_id, properties, redirect_uri,
failure_redirect_uri, token, settings.min_stay_type) → Gastgeber gibt auf Airbnb frei → Rücksprung auf `/channex/airbnb/return`
mit `success`, `channel_id`, `token` (Token in `channex_channels.auth_token`, 2 h gültig, einmalig) → `GET /channels/{id}/action/listings`
→ je Inserat `POST /channels/{id}/mappings` (`settings.listing_id`, dauert bei Airbnb ca. 30 s) → `check_readiness` → `activate`
→ `execute/load_future_reservations` mit `listing_id` je Inserat. Neu verbinden: Link mit `channel_id`.

## Expedia im Admin verbinden
Gleicher Ablauf wie Booking.com (`channels.ts`, Kanal als Parameter, Seite `app/admin/[hotelId]/channex/_meta`). Channex-Adapter `Expedia` (`GET /channels/adapter?code=Expedia`): Einstellungen `hotel_id`, `min_stay_type` (Arrival/Through), `booking_amount_settings` (Collect Amount / Total Amount / Total Amount Excluding Tax), Aktion `load_future_reservations`, Zuordnung `room_rate_multioccupancy`. Auf Staging geprüft: Adapter-Beschreibung, test_connection mit Dummy-ID (authentication_failed). Nicht geprüft (kein Expedia-Testhotel): mapping_details, Anlegen, Aktivieren. Weitere Kanäle dieser Familie (z. B. Agoda): Eintrag in `META_CHANNELS` und Migration für die CHECK-Bedingung.
