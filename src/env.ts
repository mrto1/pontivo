import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  PAYMENT_PROVIDER: z.enum(["fake", "stripe"]).default("fake"),
  /** Testumgebung (z. B. "int"): sichtbarer Hinweis, nicht indexierbar, Links immer auf APP_BASE_URL. Leer = echte Produktion. */
  ENVIRONMENT_LABEL: z.string().max(20).optional(),
  /** Testumgebung: alle ausgehenden E-Mails gehen an diese Adresse (Original im Betreff), nie an Gäste */
  MAIL_REDIRECT_TO: z.string().email().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET_CONNECT: z.string().optional(),
  // Öffentlicher Schlüssel (pk_…) für eingebettete Stripe-Komponenten (Konto eröffnen im Assistenten). Ohne: gehostetes Onboarding.
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  CHANNEX_BASE_URL: z.string().default("https://staging.channex.io/api/v1"),
  CHANNEX_API_KEY: z.string().optional(),
  CHANNEX_WEBHOOK_SECRET: z.string().optional(),
  // Cloudflare Turnstile (Bot-Schutz für Registrierung und Login). Ohne beide Schlüssel ist die Prüfung aus.
  TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  /** Rechenaufgabe (Proof of Work) für öffentliche Gäste-Formulare: "1" erzwingen, "0" aus; Standard: nur in Produktion */
  POW_REQUIRED: z.string().optional(),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  // Passwort (Basic Auth) bzw. Token (Header x-webhook-token) für den Postmark-Webhook für Bounces/Spam-Beschwerden
  POSTMARK_WEBHOOK_SECRET: z.string().optional(),
  /** SMS über ASPSMS (SPEC 20.4): ohne Zugangsdaten nur Mail und Push */
  ASPSMS_USERKEY: z.string().optional(),
  ASPSMS_PASSWORD: z.string().optional(),
  ASPSMS_ORIGINATOR: z.string().max(11).default("Pontivo"),
  /** Weiterverrechneter Preis je Gast-SMS in Rappen (Selbstkosten) */
  SMS_GUEST_PRICE_RAPPEN: z.coerce.number().int().min(0).default(8),
  // Push-Mitteilungen im Admin (Web Push). Schlüsselpaar erzeugen: npx web-push generate-vapid-keys. Ohne Schlüssel ist die Funktion aus.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(), // z. B. mailto:info@pontivo.ch (Standard: PLATFORM_ALERT_EMAIL)
  EMAIL_FROM: z.string().default("buchung@example.ch"),
  PLATFORM_ALERT_EMAIL: z.string().optional(),
  // Buchhaltung des Betreibers (Export für Banana). Kontonummern müssen zum eigenen Kontenplan passen.
  ACCOUNTING_EXPORT_DIR: z.string().optional(),
  BANANA_ACCOUNT_STRIPE: z.string().default("1090"), // Soll: Durchlaufkonto Stripe/Bank
  BANANA_ACCOUNT_REV_FEES: z.string().default("3000"), // Haben: Ertrag Plattformgebühr
  BANANA_ACCOUNT_REV_MINIMUM: z.string().default("3001"), // Haben: Ertrag Mindestgebühr
  BANANA_ACCOUNT_REV_AI: z.string().default("3002"), // Haben: Ertrag KI-Chat
  AUTH_SECRET: z.string().min(16).optional(),
  // Betreiber der Plattform (für AGB, Datenschutz, Fusszeile)
  PLATFORM_NAME: z.string().default("Pontivo"),
  PLATFORM_OPERATOR: z.string().optional(), // Standard: "Lynxora GmbH"
  PLATFORM_ADDRESS: z.string().optional(), // Standard: "Konradstrasse 1, 8400 Winterthur"
  PLATFORM_UID: z.string().optional(), // UID der Gesellschaft (CHE-…), erscheint im Impressum
  PLATFORM_VAT_NUMBER: z.string().optional(), // MWST-Nummer (CHE-… MWST), nur als Vorgabe; der Schalter in der Plattform-Verwaltung gilt
  PLATFORM_CONTACT_EMAIL: z.string().optional(),
  PLATFORM_PHONE: z.string().optional(),
  DEMO_HOTEL_SLUG: z.string().default("demo-gasthof"),
  // Native App Pontivo (mobile/README.md): Kennungen für Verknüpfung der Links (Android App Links, iOS Universal Links). Leer = Datei bleibt leer.
  ANDROID_APP_PACKAGE: z.string().optional(),
  /** SHA-256-Fingerabdruck(e) des Signaturzertifikats, getrennt durch Komma (Play Console → App-Signierung) */
  ANDROID_CERT_SHA256: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  IOS_BUNDLE_ID: z.string().optional(),
  // Automatische Übersetzung der Hotel-Texte (Claude API). Ohne Schlüssel ist der Knopf ausgeblendet.
  ANTHROPIC_API_KEY: z.string().optional(),
  TRANSLATE_MODEL: z.string().default("claude-sonnet-5-5"),
  TRANSLATIONS_PER_MONTH: z.coerce.number().int().min(0).default(50),
  // KI-Einrichtung aus Website/PDF (SPEC 19.36): günstiges Modell, Läufe je Betrieb und Monat, Obergrenze aller Läufe je 24 Stunden
  SETUP_MODEL: z.string().default("claude-haiku-5-5"),
  SETUP_RUNS_PER_MONTH: z.coerce.number().int().min(0).default(3),
  SETUP_RUNS_PER_DAY_TOTAL: z.coerce.number().int().min(0).default(100),
  // KI-Chat (SPEC 14b): Modell, technische Obergrenze Gespräche pro Hotel und Monat, Kosten pro Million Tokens (USD, für die Auswertung)
  CHAT_MODEL: z.string().default("claude-haiku-5-5"),
  // KI-Preisempfehlung (Modul ai_pricing): Modell und Obergrenze Berechnungen pro Hotel und Tag
  PRICING_MODEL: z.string().default("claude-sonnet-5-5"),
  AI_PRICING_RUNS_PER_DAY: z.coerce.number().int().min(1).default(3),
  AI_CHAT_HARD_CAP: z.coerce.number().int().min(0).default(5000),
  CHAT_COST_IN_USD_PER_MTOK: z.coerce.number().min(0).default(0.1),
  CHAT_COST_OUT_USD_PER_MTOK: z.coerce.number().min(0).default(0.5),
  // Modul Online-Check-in: Schlüssel für Geburtsdatum/Ausweisnummer/Unterschrift (32 Byte base64: openssl rand -base64 32)
  GUEST_DATA_KEY: z.string().optional(),
  HOSTING_PROVIDER: z.string().optional(),
  // Fotos: Ordner auf dem Server (Docker: als Volume einbinden)
  UPLOAD_DIR: z.string().default("./data/uploads"), // z. B. "Infomaniak Network SA, Genf (Schweiz)"
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Liest Umgebungsvariablen (SPEC 11). Leere Strings gelten als nicht gesetzt. */
export function env(): Env {
  if (cached && process.env.NODE_ENV !== "test") return cached;
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = schema.parse(raw);
  // Sicherheitsnetz: In Produktion nie Buchungen ohne Zahlung bestätigen (ausser ausdrücklich für eine Demo erlaubt)
  if (parsed.NODE_ENV === "production" && parsed.PAYMENT_PROVIDER === "fake" && raw.ALLOW_FAKE_PAYMENTS !== "1") {
    throw new Error("PAYMENT_PROVIDER=fake ist in Produktion nicht erlaubt (Buchungen würden ohne Zahlung bestätigt). PAYMENT_PROVIDER=stripe setzen.");
  }
  cached = parsed;
  return cached;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const v = env()[key];
  if (v === undefined || v === null || v === "") {
    throw new Error(`Umgebungsvariable ${String(key)} fehlt`);
  }
  return v as NonNullable<Env[K]>;
}
