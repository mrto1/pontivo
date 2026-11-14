# Testlauf: ein Gast von der Buchung bis zur Buchhaltung

Eine Geschichte, in der Reihenfolge. Du spielst alle Rollen: Gast, Rezeption, Reinigung, Chef, Treuhänder.
Bei jedem Schritt steht **Erwartet**. Weicht es ab: Schritt-Nummer, was du siehst, was du erwartet hast, notieren.

## 0. Vorbereitung (einmal, 10 Minuten)
1. Server aktualisieren: `ssh ubuntu@pontivo.ch`, dann `cd /opt/pontivo`, `git pull`, `cd deploy`, `./deploy.sh` (bei «permission denied» mit `sudo`).
2. Admin öffnen, einloggen. **Konto → Funktionen:** einschalten: Rezeption, Housekeeping, Gäste-Notizen, Gruppen, Buchhaltung-Export. (Kartenterminal und Zutritt nur, wenn du Hardware hast.)
3. **Einstellungen:** Adresse des Betriebs, IBAN (Rechnung), Check-in/Check-out-Zeit ausgefüllt? Stripe im Test-Modus verbunden?
4. **Angebot → Zimmer:** mindestens 2 Zimmertypen mit Preis. **Zimmerplan/Heute:** Zimmer mit Nummern angelegt (z. B. 101, 102).
5. Zweites Browserfenster (privat/Inkognito) für den Gast bereithalten. Testkarte: `4242 4242 4242 4242`, beliebiges Ablaufdatum in der Zukunft, beliebige CVC.

## 1. Der Gast bucht (Inkognito-Fenster)
1. Hotelseite öffnen: `https://pontivo.ch/h/<dein-slug>/de`. **Erwartet:** Seite lädt, Suchleiste sichtbar.
2. Anreise **morgen**, Abreise in 3 Tagen, 2 Erwachsene, «Verfügbarkeit prüfen». **Erwartet:** Zimmertypen mit Preis.
3. Zimmer wählen, Gastdaten eingeben (eigene E-Mail benutzen), weiter zur Zahlung.
4. Bei Stripe mit Testkarte bezahlen. **Erwartet:** Rückkehr auf die Bestätigungsseite; Bestätigungs-Mail kommt an (Link «Meine Buchung»).
5. Link in der Mail öffnen. **Erwartet:** Buchungsseite mit Referenz, Daten, Betrag.

## 2. Das Hotel sieht die Buchung (Admin)
1. **Übersicht / Buchungen:** neue Buchung, Status «bestätigt». Push-Mitteilung angekommen (falls aktiviert).
2. Buchung öffnen. **Erwartet:** Beträge stimmen mit dem, was der Gast sah.
3. **Gäste-Notizen:** Notiz «Stammgast, Zimmer oben» und Tag speichern. Unter **Gäste → Kartei** suchen. **Erwartet:** Gast gefunden, Notiz sichtbar.
4. **Kalender:** freie Zimmer für die Daten sind um 1 gesunken.

## 3. Vor der Anreise
1. **Buchungen → Zimmerplan:** der Buchung ein Zimmer (z. B. 101) zuweisen. **Erwartet:** Balken erscheint, Nummer in der Buchung.
2. **Heute:** Die Buchung steht unter «Anreisen» (am Anreisetag).
3. Online-Check-in-Link des Gastes (Mail/Buchungsseite), falls aktiv: Daten ausfüllen. **Erwartet:** erscheinen in der Kartei.

## 4. Anreise und Aufenthalt
1. **Heute → Anreisen:** Buchung als «eingecheckt» markieren. **Erwartet:** wechselt zu «im Haus».
2. Buchung → **Rechnung & Kasse:** Posten **Abendessen, 1 × CHF 50, übrige Leistungen** hinzufügen. **Erwartet:** offener Betrag steigt um CHF 50.
3. Zweiten Posten **Rabatt, −CHF 10, ohne MWST**. **Erwartet:** offener Betrag sinkt um 10.
4. Zahlung vor Ort **bar** über den offenen Betrag verbuchen. **Erwartet:** «alles bezahlt».
5. Wer Hardware hat: statt bar **Kartenterminal** (Betrag am Leser, Karte vorlegen, «Status prüfen»). **Erwartet:** Zahlung als Karte verbucht.
6. Wer Nuki hat: Buchung → **Zutritt**, «Codes jetzt erstellen», Code am Keypad testen.

## 5. Abreise und Rechnung
1. **Heute → Abreisen:** Buchung auschecken. **Erwartet:** Zimmer 101 erscheint als «schmutzig» (Reinigung).
2. Buchung → **Rechnung erstellen**. Empfänger/Firma ergänzen, ausstellen. **Erwartet:** Nummer wie `2026-0001`; Zeilen: Übernachtungen 3.8 %, Abendessen 8.1 %, Kurtaxe ohne MWST; Summen stimmen.
3. Rechnung drucken. **QR-Code mit der Banking-App scannen** (Betrag, Empfänger, Referenz prüfen). Offen aus früherer Prüfung.
4. Rechnung **per E-Mail** an dich senden, Mail öffnen, Gäste-Link der Rechnung öffnen.
5. Fehler absichtlich: **Gutschrift** über einen Teilbetrag erstellen. **Erwartet:** eigene Nummer, negative Beträge, Gesamtsaldo stimmt.

## 6. Reinigung (Handy)
1. Admin mit Rolle **Housekeeping** auf dem Handy öffnen (zweiter Benutzer unter Einstellungen). **Erwartet:** nur die Reinigungsliste, keine anderen Seiten.
2. Zimmer 101 auf «sauber» setzen, einen Mangel melden (z. B. Glühbirne). **Erwartet:** in der Rezeption sichtbar.

## 7. Gruppe (zweiter Durchlauf, kurz)
1. **Buchungen → Gruppen:** Gruppe «Firma Test» mit Zimmerblock (2 Zimmer, 3 Nächte), Freigabefrist in 7 Tagen.
2. Zwei Teilnehmer in der Rooming-Liste anlegen. **Erwartet:** Block sinkt von 2 auf 0; **Kalender** zeigt die Zimmer belegt.
3. Rooming-Liste als CSV laden, in Excel öffnen.
4. Eine Teilnehmerbuchung stornieren. **Erwartet:** Zimmer ist wieder im Block frei, nicht im freien Verkauf.

## 8. Chef: Zahlen
1. **Statistik:** Monat wählen. **Erwartet:** Belegung, ADR, RevPAR, Herkunft «direkt» stimmen ungefähr mit deinen Test-Buchungen.
2. **Gäste → Kurtaxe-Quartal:** aktuelles Quartal wählen; Kurtaxe aus deiner Buchung enthalten; CSV und Druckansicht öffnen.

## 9. Treuhänder: Buchhaltung
1. **Buchhaltung** (Menü «Mein Betrieb»): Monat wählen. **Erwartet:** Vorschau mit Rechnung, Gutschrift und Zahlungen (Stripe, bar).
2. **Prüfen:** Forderung (Soll 1100) = Rechnungstotal; MWST-Zeilen 3.8 % und 8.1 % auf Konto 2200; Kurtaxe auf 2300; Gutschrift kehrt um.
3. CSV laden, in Excel öffnen: Spalten Datum, Beleg, Text, Soll, Haben, Betrag, MWST-Satz, Referenz. **Frage an den Treuhänder:** reicht das Format, oder braucht er bexio/Abacus-Import?
4. Konten anpassen (Inhaber/Manager), CSV neu laden. **Erwartet:** neue Kontonummern.
5. Rolle **Buchhaltung** testen: eigener Benutzer sieht nur Rechnungen, Statistik, Buchhaltung.

## 10. Aufräumen und Abschluss
1. Eine Funktion ausschalten (z. B. Housekeeping): Menüpunkt weg, Daten bleiben beim Einschalten.
2. **Storno testen:** zweite Test-Buchung als Gast stornieren. **Erwartet:** Rückerstattung gemäss Bedingungen, Mail, freie Zimmer steigen.
3. Auf dem Handy: Gäste-Buchungsseite und Admin kurz durchklicken.
4. Hotel-Layouts **Redaktion** und **Galerie** (Website → Layout) mit echten Fotos ansehen.

Danach: alle Abweichungen mit Schritt-Nummer an mich.
