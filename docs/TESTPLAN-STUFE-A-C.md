# Testplan PMS Stufe A bis C (Klick-Test)

Zum Abhaken. Vorher: `git pull && cd deploy && ./deploy.sh`, dann im Admin einloggen.
**Funktionen** (Menü «Konto → Funktionen») zuerst einschalten: Rezeption, Housekeeping, Gäste-Notizen, Gruppen, Buchhaltung-Export, Kartenterminal, Zutritt (Nuki). Rechnung & Kasse, Statistik und Mail-Texte sind schon an.
Eine Test-Buchung mit Testkarte (Stripe-Sandbox) bereithalten; Anreise in 1–2 Tagen, damit «Heute» etwas zeigt.

## A – Rezeption und Rechnung
- [ ] **Heute** (Buchungen → Heute): Anreisen, Abreisen, im Haus sichtbar; Zimmer zuweisen; Zimmernummer erscheint in der Buchung.
- [ ] **Zimmerplan:** Buchung als Balken sichtbar, Zimmer lässt sich ändern.
- [ ] **Buchung → Rechnung & Kasse:** Posten hinzufügen (z. B. Abendessen CHF 50, 8.1 %), Zahlung vor Ort (bar) verbuchen; «offen» stimmt.
- [ ] **Rechnung erstellen:** Entwurf öffnen, Empfänger/Firma eintragen, ausstellen; Nummer läuft lückenlos (z. B. 2026-0001).
- [ ] MWST: Übernachtung 3.8 %, übrige Leistungen 8.1 %, Kurtaxe ohne MWST; Summen stimmen.
- [ ] **QR-Rechnung:** unter Einstellungen IBAN eintragen; Rechnung drucken. **QR mit der Banking-App scannen** (Betrag, Empfänger, Referenz prüfen). Offen aus früherer Prüfung.
- [ ] **Gutschrift** zu einer Rechnung erstellen: negative Beträge, eigene Nummer.
- [ ] **Rechnung per E-Mail** senden (Knopf) und Link für den Gast `/b/<token>/rechnung/…` öffnen.

## B – Betrieb
- [ ] **Housekeeping:** Abreise setzt Zimmer auf «schmutzig»; Handy-Liste öffnen; Zimmer auf «sauber» setzen; Mangel melden.
- [ ] **Gäste-Notizen:** Notiz und Tag bei einer Buchung speichern; in **Kartei** suchen und finden.
- [ ] **Statistik:** Belegung, ADR, RevPAR, Herkunft; Monat wechseln; Zahlen mit dem Kalender vergleichen.
- [ ] **Rollen:** Mitarbeiter mit Rolle «Rezeption», «Housekeeping», «Buchhaltung» anlegen und einloggen; jede Rolle sieht nur ihre Seiten (andere Adressen gehen nicht).
- [ ] **Mail-Texte:** eigenen Satz ändern, Test-Buchung machen, Mail prüfen (gesetzliche Inhalte unverändert).

## C – Schweiz und Vernetzung
- [ ] **Gruppen:** Gruppe mit Zimmerblock anlegen; Teilnehmer in der Rooming-Liste buchen; CSV der Rooming-Liste laden; Freigabefrist prüfen; freie Zimmer sinken im Kalender.
- [ ] **Kurtaxe-Quartal** (Gäste): Quartal wählen, Zahlen prüfen, CSV und Druckansicht.
- [ ] **Buchhaltung-Export:** Monat wählen, Vorschau prüfen, CSV laden und in Excel öffnen; Konten anpassen. **Treuhänder fragen**, welches Format er braucht (bexio/Abacus nicht belegt).
- [ ] **Kartenterminal** (nur mit Stripe-Leser): Leser mit Code registrieren; Buchung mit offenem Betrag → «Am Terminal bezahlen»; Karte vorlegen; «Status prüfen»; Zahlung erscheint als Karte. Webhook-Ereignisse `terminal.reader.action_*` im Stripe-Ziel aktiviert? Prüfen, ob die Plattformgebühr ankommt.
- [ ] **Zutritt (Nuki)** (nur mit Nuki-Hardware): Token speichern, Schlösser laden, zuordnen; «Codes jetzt erstellen» bei einer Buchung; Code am Keypad testen; zurückziehen.

## Allgemein
- [ ] Handy: Admin und Gäste-Buchungsseite bedienbar.
- [ ] Funktion ausschalten (z. B. Housekeeping): Menüpunkt und Seite verschwinden, Daten bleiben.
- [ ] Pontivo-Startseite und Hotel-Layouts **Redaktion** und **Galerie** mit echten Fotos ansehen.
- [ ] Alles Auffällige notieren (Seite, was passiert, was erwartet) und mir schicken.
