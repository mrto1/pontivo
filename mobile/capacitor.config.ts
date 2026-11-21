import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Hülle für die App «myPontivo» (Android APK/AAB und iOS), Anleitung: mobile/README.md, Spezifikation: docs/SPEC.md 19.23.
 * Die App lädt die gehostete Admin-Oberfläche (server.url); es gibt keine zweite Codebasis. Updates der Oberfläche brauchen kein Store-Update.
 * ASSUMPTION: Kennung ch.pontivo.app und Adresse pontivo.ch; beides vor dem ersten Store-Eintrag bestätigen, danach nie mehr ändern.
 */
const config: CapacitorConfig = {
  appId: "ch.pontivo.app",
  appName: "myPontivo",
  webDir: "www",
  server: {
    url: "https://pontivo.ch/admin",
    cleartext: false,
    // Nur die eigene Domain im App-Fenster; alles andere öffnet im Browser
    allowNavigation: ["pontivo.ch", "*.pontivo.ch"],
  },
  // Der Server erkennt die App daran (blendet «Als App installieren» aus, zeigt die Push-Einstellung der App)
  appendUserAgent: "MyPontivoApp/1.0",
  ios: { contentInset: "automatic" },
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
