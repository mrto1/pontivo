import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  PAYMENT_PROVIDER: z.enum(["fake", "stripe"]).default("fake"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET_CONNECT: z.string().optional(),
  // Öffentlicher Schlüssel (pk_…) für eingebettete Stripe-Komponenten (Konto eröffnen im Assistenten). Ohne: gehostetes Onboarding.
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  CHANNEX_BASE_URL: z.string().default("https://staging.channex.io/api/v1"),
  CHANNEX_API_KEY: z.string().optional(),
  CHANNEX_WEBHOOK_SECRET: z.string().optional(),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  // Passwort (Basic Auth) bzw. Token (Header x-webhook-token) für den Postmark-Webhook für Bounces/Spam-Beschwerden
  POSTMARK_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_FROM: z.string().default("buchung@example.ch"),
  PLATFORM_ALERT_EMAIL: z.string().optional(),
  AUTH_SECRET: z.string().min(16).optional(),
  // Betreiber der Plattform (für AGB, Datenschutz, Fusszeile)
  PLATFORM_NAME: z.string().default("Pontivo"),
  PLATFORM_OPERATOR: z.string().optional(), // z. B. "Pontivo, Inhaber Vorname Guidali"
  PLATFORM_ADDRESS: z.string().optional(), // z. B. "Musterstrasse 1, 8400 Winterthur"
  PLATFORM_CONTACT_EMAIL: z.string().optional(),
  PLATFORM_PHONE: z.string().optional(),
  DEMO_HOTEL_SLUG: z.string().default("demo-gasthof"),
  // Automatische Übersetzung der Hotel-Texte (Claude API). Ohne Schlüssel ist der Knopf ausgeblendet.
  ANTHROPIC_API_KEY: z.string().optional(),
  TRANSLATE_MODEL: z.string().default("claude-sonnet-5-5"),
  TRANSLATIONS_PER_MONTH: z.coerce.number().int().min(0).default(50),
  // Modul Gäste: Schlüssel für Geburtsdatum/Ausweisnummer/Unterschrift (32 Byte base64: openssl rand -base64 32)
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
