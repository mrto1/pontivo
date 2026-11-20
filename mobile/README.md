# myPontivo als App (Android und iOS)

Die App ist eine Hülle um die bestehende Admin-Oberfläche (`https://pontivo.ch/mypontivo`). Es gibt keine zweite Codebasis: Änderungen an der Oberfläche sind sofort in der App, ohne Store-Update. Die Hülle liefert, was ein Browser nicht kann: Eintrag im Play Store / App Store und Mitteilungen auf dem Handy (auf iOS und im Android-WebView funktionieren Web-Push-Mitteilungen der Webseite nicht verlässlich).

Spezifikation und Annahmen: `docs/SPEC.md` 19.23. **Was schon im Server vorbereitet ist** (committet, ohne Zutun lauffähig):
- Erkennung der App (`MyPontivoApp` im User-Agent): «Als App installieren» entfällt, auf «Mein Konto» erscheint «Mitteilungen in der App einschalten».
- `POST /api/admin/hotels/<id>/push/native` nimmt die Gerätekennung an (Tabelle `native_push_tokens`).
- `/.well-known/assetlinks.json` und `/.well-known/apple-app-site-association` (Links öffnen direkt in der App), befüllt aus `ANDROID_APP_PACKAGE`, `ANDROID_CERT_SHA256`, `APPLE_TEAM_ID`, `IOS_BUNDLE_ID` in `.env.production`.

**Noch nicht vorhanden, braucht Ihre Konten:** der Versand der Mitteilungen über Firebase (Android) und Apple (iOS), siehe Schritt 6.

## Was Sie brauchen
| Für | Was | Kosten (laut Anbieter, bitte vor dem Kauf prüfen) |
|---|---|---|
| Android | Google-Play-Entwicklerkonto, Android Studio (Windows, Mac oder Linux) | einmalige Gebühr |
| iOS | Apple-Developer-Programm, ein Mac mit Xcode (iOS-Apps lassen sich nur auf einem Mac bauen und signieren) | jährliche Gebühr |
| Mitteilungen | Firebase-Projekt (Cloud Messaging), für iOS zusätzlich ein APNs-Schlüssel aus dem Apple-Konto | – |
| Bilder | Icon, Splash, Screenshots (`mobile/resources/README.md`) | – |

## 1. Einmalig einrichten (auf dem Rechner, der baut)
```bash
cd mobile
npm init -y
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios @capacitor/push-notifications @capacitor/splash-screen @capacitor/status-bar
npx cap add android      # erzeugt mobile/android
npx cap add ios          # nur auf dem Mac, erzeugt mobile/ios
```
Die Kennung `ch.pontivo.mypontivo` und die Adresse stehen in `capacitor.config.ts`. **Beides vor dem ersten Store-Eintrag bestätigen**, die Kennung lässt sich später nicht mehr ändern.

## 2. Android (APK für Tests, AAB für den Play Store)
1. `npx cap sync android`, dann `npx cap open android` (Android Studio).
2. Icon/Splash: `npx @capacitor/assets generate` mit den Bildern aus `mobile/resources`.
3. Test auf dem Handy: Build → «Build APK». Die APK lässt sich direkt installieren (Entwickleroptionen aktivieren).
4. Store: Build → «Generate Signed Bundle» (AAB). **Den Schlüsselspeicher (`.keystore`) und sein Passwort sicher aufbewahren** (nicht ins Repository, ist in `.gitignore`); ohne ihn gibt es keine Updates. Besser: «Play App Signing» in der Play Console nutzen.
5. In der Play Console: App anlegen, Datenschutzerklärung (Adresse der Pontivo-Seite), Datensicherheitsangaben, Inhaltseinstufung, Testphase (neue Entwicklerkonten brauchen eine geschlossene Testphase mit mehreren Testern, bevor die Veröffentlichung freigegeben wird; Vorgaben von Google bitte aktuell lesen).
6. Den SHA-256-Fingerabdruck des Signaturzertifikats (Play Console → App-Integrität) in `.env.production` als `ANDROID_CERT_SHA256` eintragen, `ANDROID_APP_PACKAGE=ch.pontivo.mypontivo`, dann `./deploy.sh`. Prüfung: `https://pontivo.ch/.well-known/assetlinks.json`.

## 3. iOS (auf dem Mac)
1. `npx cap sync ios`, `npx cap open ios` (Xcode).
2. Unter «Signing & Capabilities»: Team wählen, Bundle-ID `ch.pontivo.mypontivo`, Capabilities **Push Notifications** und **Associated Domains** (`applinks:pontivo.ch`) hinzufügen.
3. In App Store Connect die App anlegen, in Xcode «Product → Archive» und hochladen, über TestFlight testen.
4. `APPLE_TEAM_ID` und `IOS_BUNDLE_ID` in `.env.production` eintragen, deployen. Prüfung: `https://pontivo.ch/.well-known/apple-app-site-association`.
5. **Prüfung durch Apple:** Reine Web-Hüllen werden manchmal abgelehnt («Mindestfunktionalität»). Was für die App spricht und im Prüfhinweis stehen sollte: echte Mitteilungen auf dem Gerät, Passkey/Anmeldung, Offline-Tagesliste, Kamera/Datei-Zugriff, wo vorhanden. Eine Demo-Zugangsdaten-Angabe für den Prüfer bereithalten (Testbetrieb mit Rolle Rezeption).

## 4. Anmeldung und Sicherheit
- Die App nutzt dieselbe Anmeldung wie der Browser (Link per E-Mail, Passkey, 2FA). Passkeys in der Hülle: auf iOS und Android nur mit der Domain-Verknüpfung (Schritt 2.6 / 3.4) lauffähig; **mit echten Geräten testen**.
- Die Adresse ist fest (`allowNavigation`), fremde Seiten öffnen im Browser.
- Keine Geheimnisse in der App: sie enthält nur die Adresse. Keystore, `google-services.json`, `GoogleService-Info.plist`, APNs-Schlüssel gehören nicht ins Repository.

## 5. Updates
- Oberfläche: gar nichts tun (Deploy genügt).
- Nur bei neuen nativen Funktionen oder Plugin-Updates: `npx cap sync`, Versionsnummer erhöhen (Android `versionCode`, iOS Build-Nummer), neu bauen und einreichen.

## 6. Mitteilungen (nächster Ausbau, braucht Ihre Konten)
1. Firebase-Projekt anlegen, Android-App (`ch.pontivo.mypontivo`) registrieren, `google-services.json` nach `mobile/android/app/` legen; iOS-App registrieren, `GoogleService-Info.plist` nach `mobile/ios/App/App/`, APNs-Schlüssel in Firebase hochladen.
2. Dienstkonto-Schlüssel für Firebase Cloud Messaging (HTTP v1) erzeugen und als Geheimnis in `.env.production` hinterlegen.
3. Dann wird der Versand gebaut: Sender neben dem bestehenden Web-Push (`src/push/service.ts`), der an die Tokens aus `native_push_tokens` sendet. **Vorher die aktuelle FCM-Dokumentation lesen** (keine erfundenen Felder); bis dahin erhalten App-Nutzer die Mitteilungen nicht, die Geräte sind aber schon angemeldet.

## Reihenfolge (Empfehlung)
Android-APK bauen und mit 2 Personen testen → Entwicklerkonten und Bilder bereitstellen → Mitteilungen (Schritt 6) → Play-Store-Testphase → iOS über TestFlight → Veröffentlichung.
