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
- [x] Channex: Zuschläge pro Person (extra_adult, Einzelrabatt) werden übertragen – Tarife mit Zuschlag/Rabatt als `per_person` mit Preis je Belegung (gegen Channex-Staging geprüft, 8.11.2026).
- [ ] Channex: Wird bei einem verbundenen `per_room`-Tarif später ein Zuschlag/Einzelrabatt eingetragen, bleibt der Tarif in Channex `per_room` (nur Basispreis). Lösung offen: Tarif in Channex umstellen oder neu verbinden.
- [ ] Channex lehnt zwei Tarife mit gleichem Namen im selben Zimmertyp ab ("Duplication in Rate Plan title"). Pontivo prüft das beim Anlegen noch nicht.
- [ ] Stripe/TWINT: Branchencode (MCC) für Hotels – TWINT ist für einzelne Branchen eingeschränkt. Mit Stripe klären, bevor das erste Hotel live geht.

- [ ] Übersetzungen der festen Texte (Buchungsstrecke, Mails, Storno) FR/IT/NL von Muttersprachlern gegenlesen lassen.
- [ ] AGB und Datenschutz auf FR/IT/NL übersetzen und prüfen lassen.

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
| Dokumente | PDFs im selben Ordner wie Fotos, an den Bytes erkannt (`%PDF-`), max. 15 MB, höchstens 30 pro Hotel; gelöschte Dokumente verschwinden aus Downloads-Bausteinen | `src/lib/storage.ts`, `src/services/site.ts` |
