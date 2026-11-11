# Offene Fragen und getroffene Annahmen

Annahmen sind im Code mit `// ASSUMPTION:` markiert (`grep -rn "ASSUMPTION" src app`).

## Offene Fragen (aus SPEC 15)

- [ ] Channex: Produktions-URL und Preise für Staging/Produktion.
- [ ] Kurtaxe: Zeilen mit `status='needs_confirmation'` (Wildhaus-Alt St. Johann, Speicher, Hundwil) und AI-Satz (2.50 laut Verordnung, 2.70 laut Drittquelle). Hotels können den Satz im Admin bestätigen.
- [ ] AVS-Schnittstelle (Format, Zugang, Kosten) für Meldeschein, Kurtaxe und HESTA.
- [ ] Gästemeldung Appenzell Innerrhoden.
- [ ] Hotels mit eigenem Channel-Manager (z. B. Hotel-Spider) statt Channex.
- [ ] Rechtstexte: AGB und Datenschutzerklärung für Gäste liegen als Entwurf vor (`src/legal/texts.ts`) – juristisch prüfen lassen. Es fehlt noch der Vertrag mit dem Hotel inkl. Auftragsbearbeitungsvereinbarung. Betreiberangaben in `PLATFORM_*` setzen.
- [ ] Channex-Feed: Namen der Paginierungsparameter (Doku nennt sie nicht).
- [x] Channex-Webhook signiert (HMAC) gegen Staging getestet, 10.11.2026: Buchung neu und Storno kommen in Sekunden an.
- [x] Channex: Zuschläge pro Person (extra_adult, Einzelrabatt) werden übertragen – Tarife mit Zuschlag/Rabatt als `per_person` mit Preis je Belegung (gegen Channex-Staging geprüft, 8.11.2026).
- [ ] Channex: Wird bei einem verbundenen `per_room`-Tarif später ein Zuschlag/Einzelrabatt eingetragen, bleibt der Tarif in Channex `per_room` (nur Basispreis). Lösung offen: Tarif in Channex umstellen oder neu verbinden.
- [ ] Channex lehnt zwei Tarife mit gleichem Namen im selben Zimmertyp ab ("Duplication in Rate Plan title"). Pontivo prüft das beim Anlegen noch nicht.
- [ ] Stripe/TWINT: Branchencode (MCC) für Hotels – TWINT ist für einzelne Branchen eingeschränkt. Mit Stripe klären, bevor das erste Hotel live geht.

- [ ] Übersetzungen der festen Texte (Buchungsstrecke, Mails, Storno) FR/IT/NL von Muttersprachlern gegenlesen lassen.
- [ ] AGB und Datenschutz auf FR/IT/NL übersetzen und prüfen lassen.

- [ ] Gutscheine: Gültigkeitsdauer und Bedingungen in den AGB rechtlich prüfen lassen (auch: gilt der Gutschein, wenn am Buchungstag gültig, der Aufenthalt aber danach liegt?).
- [ ] Gutscheine: Mehrwertsteuer-Behandlung (Wertgutschein, MWST erst bei Einlösung) mit Treuhand klären.

- [ ] Modul Gäste: Müssen Kinder ohne eigenen Ausweis einen Ausweistyp/-nummer angeben? Heute Pflicht ab 18, für Kinder freiwillig.
- [ ] Modul Gäste: Genügt in GL die Unterschrift der Kontaktperson für alle Mitreisenden derselben Buchung, oder muss jede erwachsene Person unterschreiben?
- [ ] Modul Gäste: Teilnehmerliste für Gruppen ist nur für SG belegt; gilt sie auch in TG/AR/GL? (`canton_rules.group_list_allowed`)
- [ ] Modul Gäste: Kurtaxe-Liste – verlangen die Gemeinden ein bestimmtes Format (AVS, Excel-Vorlage)? Heute CSV und Druck.
- [ ] Übersicht «Ihr Nutzen»: Provision der Portale je Hotel unterschiedlich (Standard 15 %, im Admin änderbar). Prüfen, ob die Darstellung als «gespart» rechtlich und gegenüber Hotels unbedenklich ist (Kartengebühren nicht abgezogen).
- [ ] Zusatzleistungen: Obligatorische Gebühren (z. B. Endreinigung) werden nicht an Channex übertragen – Hotel muss sie im Portal selbst erfassen. Klären, ob Channex dafür ein Feld hat.
- [ ] Bedingungen für Gastgeber (`src/legal/host-terms.ts`, Seite /gastgeber-bedingungen): Entwurf juristisch prüfen lassen, inkl. Auftragsbearbeitung; FR/IT-Fassung.
- [ ] Mindestgebühr CHF 19/Monat: MWST-Pflicht von Pontivo klären (Preise heute «ohne MWST, sofern geschuldet»).
- [ ] Kurtaxe-Kategorie für Ferienwohnungen: heute «group» (Parahotellerie) – pro Gemeinde prüfen, ob es eine eigene Kategorie oder Pauschalen pro Wohnung gibt (häufig bei Zweitwohnungen).
- [ ] Mindestgebühr gilt heute für alle selbst registrierten Betriebe, von Hand angelegte Hotels ohne Minimum. Bestätigen; Änderung pro Betrieb heute nur direkt in der Datenbank (`hotels.monthly_minimum_rappen`).

## Getroffene Annahmen (v1)

| Thema | Annahme | Ort |
| --- | --- | --- |
| Hold-Dauer | 32 statt 30 Minuten, weil Stripe `expires_at` mindestens 30 Minuten nach Erstellung der Session verlangt | `src/services/bookings.ts` |
| Stripe-Webhooks | Verarbeitung direkt im Request; bei Fehler 500 → Stripe wiederholt; unverarbeitete Ereignisse werden erneut verarbeitet | `src/integrations/stripe/webhooks.ts` |
| TWINT ausblenden | `excluded_payment_method_types: ['twint']`, wenn TWINT nicht aktiv oder Betrag > CHF 5'000 | `src/integrations/stripe/provider.ts` |
| Login | Eigene Magic-Link-Implementierung, Tabelle `login_tokens` (nur Hash), signiertes Cookie (30 Tage) | `src/auth/session.ts`, Migration 0002 |
| Website-Texte | Neue Spalte `hotels.content` (DE/EN, Fotos) | Migration 0002 |
| Kinderalter | Neue Spalte `bookings.children_ages`; Pflicht, wenn die Kurtaxe-Regel Altersgrenzen hat | Migration 0002, `src/services/search.ts` |
| Überbuchung | Neue Spalte `bookings.overbooked` (für M3) | Migration 0002 |
| Rate-Limit | Im Speicher pro Instanz (10 POST/Minute/IP) | `src/lib/rate-limit.ts` |
| E-Mail-Templates | HTML in TypeScript statt React Email (keine Zusatzabhängigkeit) | `src/email/templates.ts` |
| Neue Tage im Horizont | Preis/Regeln vom gleichen Wochentag eine Woche vorher | `src/services/inventory.ts` |
| Zimmer sperren | `blocked` wird auf `total` begrenzt | `src/services/inventory.ts` |
| Stornierung durch Gast | Nur bis zum Anreisetag; danach nur durch das Hotel | `src/services/bookings.ts` |
| Channex-Outbox | Vergangene Tage weggelassen, höchstens 500 Tage in die Zukunft (Channex `state_length`); fehlende Preiszeile → `stop_sell`; `max_stay` NULL → 0 | `src/integrations/channex/outbox-worker.ts` |
| Channex per_person | Primäre Belegung = `base_occupancy`; Optionen 1 … `max_adults`; Preise je Belegung nach `priceForNight` ohne Kinder; von Hand zugeordnete Tarife gelten als `per_room` | `src/integrations/channex/connect.ts`, `outbox-worker.ts` |
| Channex-Feed | Paginierung durch erneutes Laden der ersten Seite nach den Acks; fehlgeschlagene Revisionen blockieren weitere Revisionen derselben Buchung im Lauf | `src/integrations/channex/feed.ts` |
| OTA-Buchungen | Kurtaxe 0 (unbekannt), `days` fehlt → Betrag gleichmässig verteilt | `src/integrations/channex/feed.ts` |
| Monatsabrechnung | Stichtag Bestätigung (Hotelzeit), Rückerstattungen beim Buchungsmonat, Netto-Gebühr anteilig; PDF über Druckansicht des Browsers | `src/services/report.ts` |
| Fotos | Lokaler Ordner `UPLOAD_DIR` statt S3, keine Verkleinerung, max. 8 MB, nur JPG/PNG/WebP (an den Bytes erkannt) | `src/lib/storage.ts` |
| Zimmeranzahl | Weniger Zimmer als ab heute gebucht/gesperrt wird abgelehnt; `total` wird ab heute nachgeführt | `src/services/rooms.ts` |
| Website-Editor | Feste Bausteine statt freiem Baukasten; Bilder nur aus der Foto-Bibliothek des Hotels; Vorschau aktualisiert sich beim Speichern (nicht bei jedem Tastendruck) | `src/domain/blocks.ts` |
| Textformatierung | Gespeichert als reiner Text mit einfachen Zeichen (`**`, `*`, `__`, `==`, `[Text](URL)`, `- `, `1. `, `## `), dargestellt ohne HTML aus den Daten; Links nur http(s), mailto, tel oder eigener Pfad; Farbe nur in der Hausfarbe, keine freie Farbwahl | `src/domain/richtext.ts` |
| Gestaltung | Layout und Schrift sind Einstellungen (`hotels.content.brand.layout/font`), nur CSS-Unterschiede; Schriften über next/font selbst gehostet, nur verwendete werden geladen; Ausrichtung/Grösse pro Baustein unter «Erweitert» (links/zentriert, normal/gross) | `src/domain/theme.ts`, `app/globals.css` |
| Sprachen | Deutsch ist immer Ausgangssprache und immer angeboten; Rückfall fehlender Texte: gewünschte Sprache → EN → DE; Sprachen, die ein Hotel nicht anbietet, ergeben 404; Hotel-interne Mails bleiben DE/EN | `src/i18n/dict.ts` |
| Rechtstexte FR/IT/NL | AGB und Datenschutz nur DE/EN; FR/IT/NL zeigen Englisch mit Hinweis, bis übersetzte Texte juristisch geprüft sind | `src/legal/texts.ts` |
| Automatische Übersetzung | Claude API (Messages), Modell `claude-sonnet-5-5`, ein Aufruf pro Seite bzw. Zimmerliste; zählt nur bei Erfolg; Pontivo trägt die Kosten; Limit 50 pro Hotel und Monat | `src/services/translate.ts` |
| Gutscheine | Wertgutscheine, Kauf wie Buchung (Direct Charge, 1 %), Code GS-XXXX-XXXX, Gültigkeit Standard 3 Jahre. Einlösen im Admin oder bei der Online-Buchung: Betrag wird beim Hold gesperrt, bei Ablauf gutgeschrieben, Storno anteilig auf Gutschein und Karte; 1 % Gebühr nur auf den Kartenteil; gültig, wenn am Buchungstag nicht abgelaufen | `src/services/vouchers.ts` |
| Anfragen | HTML-Formular ohne JavaScript, Spam-Schutz mit verstecktem Feld und 5 Anfragen pro Minute und IP, keine Speicherung über die Anfrage hinaus | `app/api/inquiry/route.ts` |
| Pakete | Ein Paket ist ein Tarif mit Mindestaufenthalt (`rate_plans.min_nights`), gilt zusätzlich zu den Tagesregeln und wird an Channex als min_stay_arrival gesendet | `src/services/search.ts` |
| Gästestimmen | Werden nicht als Review-Markup ausgezeichnet (Google wertet selbst veröffentlichte Bewertungen nicht) | `src/lib/structured-data.ts` |
| Dokumente | PDFs im selben Ordner wie Fotos, an den Bytes erkannt (`%PDF-`), max. 15 MB, höchstens 30 pro Hotel; gelöschte Dokumente verschwinden aus Downloads-Bausteinen | `src/lib/storage.ts`, `src/services/site.ts` |
| Übersicht «Ihr Nutzen» | Ersparnis = Zimmerumsatz der Direktbuchungen × Portal-Provision − Pontivo-Gebühr netto; bestätigte Buchungen im Bestätigungsmonat, ohne Stornos, ohne Kartengebühren | `src/services/overview.ts` |
| Gästedaten verschlüsselt | Geburtsdatum, Ausweisnummer, Unterschrift mit AES-256-GCM (`GUEST_DATA_KEY`), Unterschrift als verschlüsselte PNG-data-URL in der Datenbank statt als Datei; Alter bei Anreise unverschlüsselt für die Kurtaxe-Liste | `src/lib/guest-crypto.ts`, `src/services/guests.ts` |
| Check-in-Link | Job alle 10 Minuten reiht den Link für bestätigte Buchungen (auch Portale, wenn E-Mail bekannt) 7 Tage vor Anreise um 10:00 ein, bei späterer Buchung sofort | `src/services/guests.ts` |
| Meldeschein | Korrektur durch den Gast möglich, bis das Personal «Ausweis gesehen» bestätigt; Unterschrift nur von Person 1; Löschung am Tag nach `retention_until` | `src/services/guests.ts` |
| Kurtaxe-Liste | Nächte im Monat; Alter laut Meldeschein, sonst Erwachsene laut Buchung und Kinder nach angegebenem Alter | `src/services/guests.ts` |
| Zusatzleistungen | Pro Aufenthalt, pro Nacht, pro Person, pro Person und Nacht; obligatorische im angezeigten Gesamtpreis (PBV); Name und Preis bei der Buchung eingefroren; Stornogebühr nur auf den Zimmerpreis, Zusatzleistungen werden immer erstattet; 1 % Gebühr auch auf Zusatzleistungen; Portal-Buchungen ohne Zusatzleistungen | `src/domain/extras.ts`, `src/services/bookings.ts` |
| Restaurant | Speisekarte mit Preisen in Rappen, Öffnungszeiten Mo–So mit bis zu 3 Fenstern, Tischreservation ist eine Anfrage (keine Tischverwaltung) | `src/domain/blocks.ts` |
| Selbst-Registrierung | Jeder kann sich registrieren (Spam-Schutz: verstecktes Feld, 3 Versuche pro Minute und IP); Betrieb startet als Entwurf und ist erst nach dem Assistenten buchbar; Fortschritt wird aus den Daten abgeleitet | `src/services/onboarding.ts` |
| Mindestgebühr | Ab dem ersten vollen Monat nach dem Live-Gang, auch in pausierten Monaten; Differenz zu den 1 % (Buchungen netto + Gutscheine) wird Anfang Folgemonat der Karte belastet; 3 Versuche im Abstand von 3 Tagen; Karte über Stripe Checkout (setup) auf dem Plattform-Konto, ohne Webhook (Rückkehrseite liest die Session) | `src/services/billing.ts` |
| Fester Anreisetag | `rate_plans.arrival_weekdays`; an Channex als closed_to_arrival übertragen | `src/services/search.ts` |
| Stripe-Konto Privatvermieter | Rechtsform wird nur bei Hotels als Firma vorgegeben, sonst wählt der Gastgeber im Stripe-Onboarding | `src/integrations/stripe/onboarding.ts` |
| Buchung erfassen (Hotel) | Quelle `admin`, sofort bestätigt, bezahlt vor Ort, keine Plattformgebühr; Preis/Kurtaxe aus dem Kalender, gleiche Regeln wie online (kein freier Preis, keine Ausnahme von Mindestnächten); Bestätigung an den Gast optional | `src/services/admin-bookings.ts` |
| Aufenthalt verschieben | Nur Direkt-/Hotelbuchungen, gleiche Anzahl Nächte und gleiches Zimmer, vereinbarte Preise bleiben (keine Zahlungsänderung); Kalenderregeln gelten nicht, nur die Verfügbarkeit; Erinnerungen werden neu geplant. Verlängern, Verkürzen und Zimmerwechsel offen | `src/services/admin-bookings.ts` |
| Channex nur Delta | Restriktionen: nur die geänderten Felder (`channex_outbox.fields`), Werte aus der DB; Vollabgleich, neue Tage und Tarifänderungen senden alle Felder | `src/integrations/channex/outbox-worker.ts` |
| Hinweis vor dem Verbinden | Auf der Channex-Seite: Hinweise zu Booking.com (Aktivierung überschreibt) und Airbnb (Sofortbuchung, Smart Pricing aus), Prüfung der Preis-Abdeckung (mind. 90 Tage ab heute, Annahme) und Pflicht-Checkbox vor «Abgleich einschalten» | `app/admin/[hotelId]/channex/page.tsx`, `src/domain/channex-readiness.ts` |
| Postmark Bounce/Spam | Webhook `/api/webhooks/postmark` (Basic Auth oder Header `x-webhook-token` mit `POSTMARK_WEBHOOK_SECRET`; Postmark signiert nicht). Sperrliste `email_suppressions` ist plattformweit (ohne hotel_id), Sperre nur bei Spam-Beschwerde und bei Bounces mit `Inactive: true`; E-Mails an gesperrte Adressen werden als `cancelled` verworfen. Hotel wird noch nicht benachrichtigt (offen) | `src/email/suppressions.ts` |
