/**
 * Drizzle-Abbild von db/migrations/*.sql (Quelle der Wahrheit bleibt SQL, SPEC 2).
 * Bei Schemaänderungen: neue Datei in db/migrations/ UND diese Datei nachführen.
 */
import { sql } from "drizzle-orm";
import { DEFAULT_PLATFORM_FEE_BPS } from "../domain/fee";
import {
  pgTable, uuid, text, char, integer, boolean, timestamp, time, date, jsonb, bigserial, bigint, primaryKey,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const hotels = pgTable("hotels", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  addressLine: text("address_line"),
  postalCode: text("postal_code"),
  city: text("city"),
  canton: char("canton", { length: 2 }).notNull(),
  municipality: text("municipality"),
  primaryDomain: text("primary_domain").unique(),
  currency: char("currency", { length: 3 }).notNull().default("CHF"),
  timezone: text("timezone").notNull().default("Europe/Zurich"),
  defaultLanguage: text("default_language").notNull().default("de"),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone"),
  platformFeeBps: integer("platform_fee_bps").notNull().default(DEFAULT_PLATFORM_FEE_BPS),
  /** Anzahlung (SPEC 5.9): Anteil in Basispunkten bei Buchung, 10000 = volle Zahlung; Rest «balanceDueDays» vor Anreise */
  depositBps: integer("deposit_bps").notNull().default(10000),
  balanceDueDays: integer("balance_due_days").notNull().default(7),
  touristTaxIncludedInPrice: boolean("tourist_tax_included_in_price").notNull().default(false),
  touristTaxCategory: text("tourist_tax_category").notNull().default("hotel"),
  checkinTime: time("checkin_time").notNull().default("15:00"),
  checkoutTime: time("checkout_time").notNull().default("11:00"),
  stripeAccountId: text("stripe_account_id").unique(),
  stripeChargesEnabled: boolean("stripe_charges_enabled").notNull().default(false),
  stripeTwintActive: boolean("stripe_twint_active").notNull().default(false),
  channexPropertyId: uuid("channex_property_id").unique(),
  channexEnabled: boolean("channex_enabled").notNull().default(false),
  /** Channex-Gruppe der Property (nötig für Kanalverbindungen) */
  channexGroupId: uuid("channex_group_id"),
  status: text("status").notNull().default("draft"),
  content: jsonb("content").$type<HotelContent>().notNull().default({}),
  /** Objektart (Migration 0011): steuert Texte und Schritte im Einrichtungs-Assistenten */
  propertyType: text("property_type").$type<"hotel" | "bnb" | "apartment" | "chalet" | "group_house">().notNull().default("hotel"),
  /** Mindestgebühr pro Monat (0 = keine); Differenz zur Plattformgebühr wird monatlich der Karte belastet */
  monthlyMinimumRappen: integer("monthly_minimum_rappen").notNull().default(0),
  hostTermsVersion: text("host_terms_version"),
  hostTermsAcceptedAt: ts("host_terms_accepted_at"),
  liveSince: ts("live_since"),
  billingCustomerId: text("billing_customer_id"),
  billingPaymentMethodId: text("billing_payment_method_id"),
  billingCardLabel: text("billing_card_label"),
  onboarding: jsonb("onboarding").$type<{ startedAt?: string; completedAt?: string; reminders?: number; alertedAt?: string; embeddedAt?: string; modulesChosenAt?: string; previousSoftware?: "none" | "yes"; switchover?: { confirmed?: string[]; oldFuture?: number; switchedAt?: string } }>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type HotelContent = {
  /** Alte Startseite ohne Editor: Titel/Einleitung pro Sprache */
  de?: { headline?: string; intro?: string };
  en?: { headline?: string; intro?: string };
  fr?: { headline?: string; intro?: string };
  it?: { headline?: string; intro?: string };
  nl?: { headline?: string; intro?: string };
  photos?: { url: string; alt?: string }[];
  /** Website-Schnittstelle: erlaubte Rückkehr-Adressen nach der Zahlung (nur Ursprung, https) */
  api?: { returnOrigins?: string[] };
  /** Zahlung (SPEC 19.25): Stripe Checkout eingebettet statt Weiterleitung */
  payment?: { embedded?: boolean };
  /** Angebotene Sprachen der Website (src/i18n/dict.ts hotelLocales), fehlt = Deutsch und Englisch */
  languages?: string[];
  /** Automatische Übersetzungen pro Monat ("YYYY-MM" → Anzahl), für das Limit */
  translations?: Record<string, number>;
  /** Gutscheine: Verkauf an/aus, Beträge, Gültigkeit (src/services/vouchers.ts) */
  vouchers?: { enabled?: boolean; amounts?: number[]; minRappen?: number; maxRappen?: number; validityYears?: number };
  /** Provision der Buchungsportale in Basispunkten (1500 = 15 %), für die Übersicht «Ihr Nutzen» */
  otaCommissionBps?: number;
  /** Infos zur Ankunft (Schlüssel, Code, WLAN, Parkplatz), gehen mit der Mail vor der Anreise an den Gast */
  arrivalInfo?: Partial<Record<"de" | "en" | "fr" | "it" | "nl", string>>;
  /** Infos für den Aufenthalt (Frühstück, Hausregeln, Tipps), im Gästeportal /b/<token> für bestätigte Buchungen (SPEC 19.13) */
  guestInfo?: Partial<Record<"de" | "en" | "fr" | "it" | "nl", string>>;
  /** Dokumente (PDF) für den Baustein «Downloads», z. B. Speisekarte, Preisliste */
  documents?: HotelDocument[];
  /** Erscheinungsbild der Buchungsseite */
  brand?: HotelBrand;
  /** Rechnung: MWST, IBAN, Zahlungsfrist (src/domain/invoice.ts, SPEC 16.3) */
  invoicing?: Partial<import("../domain/invoice").InvoicingSettings>;
  /** eigene Texte für Gäste-Mails (SPEC 17.5): Mail → Sprache → Betreff/Einleitung/Schluss */
  mailTexts?: import("../domain/mail-texts").MailTexts;
  /** Kontenzuordnung für das Buchungsjournal (SPEC 18.3) */
  accounting?: { accounts?: Partial<import("../domain/accounting-export").AccountMap> };
  /** Bewertungen einholen (SPEC 19.2): Link zur öffentlichen Bewertungsseite und ab welcher Note er gezeigt wird */
  feedback?: { reviewUrl?: string; minScore?: number };
  /** Direktbuchungs-Werkzeuge (SPEC 19.29), alle je Betrieb ein-/ausschaltbar */
  direct?: import("../domain/direct-tools").DirectSettings;
  /** Nuki Web API: Token verschlüsselt (SPEC 18.5) */
  nuki?: { tokenEnc?: string };
};

export type HotelDocument = { url: string; title: Partial<Record<"de" | "en" | "fr" | "it" | "nl", string>>; bytes: number };

export type HotelBrand = {
  /** Hauptfarbe als #rrggbb */
  color?: string;
  logoUrl?: string;
  /** Eigene Website des Hotels (Modus "booking_only": Link zurück) */
  websiteUrl?: string;
  /** "website" = Pontivo ist die Hotel-Website; "booking_only" = Hotel behält seine Website, Pontivo nur Buchung */
  mode?: "website" | "booking_only";
  /** Layout der Website (src/domain/theme.ts), fehlt = "klassisch" */
  layout?: string;
  /** Schriftpaar (src/domain/theme.ts), fehlt = "klassisch" */
  font?: string;
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  emailLoginDisabled: boolean("email_login_disabled").notNull().default(false),
  emailVerifiedAt: ts("email_verified_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const hotelMembers = pgTable(
  "hotel_members",
  {
    hotelId: uuid("hotel_id").notNull().references(() => hotels.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: text("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.hotelId, t.userId] })],
);

export const hotelModules = pgTable(
  "hotel_modules",
  {
    hotelId: uuid("hotel_id").notNull(),
    module: text("module").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    settings: jsonb("settings").notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.hotelId, t.module] })],
);

export const loginTokens = pgTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const roomTypes = pgTable("room_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  /** Ankunftsinfos dieser Wohnung/dieses Zimmers (Code, WLAN …), überschreiben die allgemeinen des Hotels; nie in Logs oder KI-Prompts */
  arrivalInfo: text("arrival_info"),
  maxAdults: integer("max_adults").notNull(),
  maxChildren: integer("max_children").notNull().default(0),
  maxOccupancy: integer("max_occupancy").notNull(),
  roomCount: integer("room_count").notNull(),
  photos: jsonb("photos").$type<{ url: string; alt?: string }[]>().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  channexRoomTypeId: uuid("channex_room_type_id").unique(),
  /** geheimer Token der Export-Feed-URL (iCal), pro Zimmertyp; erneuerbar */
  icalToken: text("ical_token").notNull().unique().default(sql`(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))`),
  active: boolean("active").notNull().default(true),
  i18n: jsonb("i18n").$type<Partial<Record<"en" | "fr" | "it" | "nl", { name?: string; description?: string }>>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const ratePlans = pgTable("rate_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  roomTypeId: uuid("room_type_id").notNull(),
  name: text("name").notNull(),
  breakfastIncluded: boolean("breakfast_included").notNull().default(true),
  /** Verpflegung: none | breakfast | half | full. breakfastIncluded bleibt als abgeleiteter Wert (board != none) */
  board: text("board").$type<"none" | "breakfast" | "half" | "full">().notNull().default("none"),
  /** Wert der Verpflegung je Person und Nacht (Rappen), nur Halb-/Vollpension: wird auf der Rechnung zum Normalsatz abgespalten */
  mealRappen: integer("meal_rappen").notNull().default(0),
  freeCancelHours: integer("free_cancel_hours"),
  cancelFeeBps: integer("cancel_fee_bps").notNull().default(10000),
  baseOccupancy: integer("base_occupancy").notNull().default(2),
  extraAdultRappen: integer("extra_adult_rappen").notNull().default(0),
  singleDiscountRappen: integer("single_discount_rappen").notNull().default(0),
  channexRatePlanId: uuid("channex_rate_plan_id").unique(),
  /** Mindestaufenthalt dieses Tarifs (z. B. Paket «3 Nächte»), zusätzlich zu den Tagesregeln im Kalender */
  minNights: integer("min_nights").notNull().default(1),
  /** fester Anreisetag: leer = jeder Tag, sonst Wochentage 0 (So) … 6 (Sa) */
  arrivalWeekdays: integer("arrival_weekdays").array().notNull().default([]),
  /** Tarif ist in Channex als sell_mode "per_person" angelegt → Preise je Belegung senden */
  channexPerPerson: boolean("channex_per_person").notNull().default(false),
  active: boolean("active").notNull().default(true),
  i18n: jsonb("i18n").$type<Partial<Record<"en" | "fr" | "it" | "nl", { name?: string }>>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const inventoryDays = pgTable(
  "inventory_days",
  {
    hotelId: uuid("hotel_id").notNull(),
    roomTypeId: uuid("room_type_id").notNull(),
    night: date("night", { mode: "string" }).notNull(),
    total: integer("total").notNull(),
    booked: integer("booked").notNull().default(0),
    blocked: integer("blocked").notNull().default(0),
    /** durch importierte iCal-Kalender belegt (nie manuell setzen, SPEC 7b) */
    externalBlocked: integer("external_blocked").notNull().default(0),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roomTypeId, t.night] })],
);

export const ratesDays = pgTable(
  "rates_days",
  {
    hotelId: uuid("hotel_id").notNull(),
    ratePlanId: uuid("rate_plan_id").notNull(),
    night: date("night", { mode: "string" }).notNull(),
    priceRappen: integer("price_rappen").notNull(),
    minStayArrival: integer("min_stay_arrival").notNull().default(1),
    maxStay: integer("max_stay"),
    closedToArrival: boolean("closed_to_arrival").notNull().default(false),
    closedToDeparture: boolean("closed_to_departure").notNull().default(false),
    stopSell: boolean("stop_sell").notNull().default(false),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ratePlanId, t.night] })],
);

export const guests = pgTable("guests", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  language: text("language").notNull().default("de"),
  marketingConsent: boolean("marketing_consent").notNull().default(false),
  marketingConsentAt: ts("marketing_consent_at"),
  /** Datenübernahme (Migration 0057): von diesem Auftrag angelegt */
  importJobId: uuid("import_job_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  reference: text("reference").notNull().unique(),
  publicToken: text("public_token").notNull().unique(),
  source: text("source").notNull(),
  status: text("status").notNull(),
  checkin: date("checkin", { mode: "string" }).notNull(),
  checkout: date("checkout", { mode: "string" }).notNull(),
  /** Firmenkunde, dem die Buchung in Rechnung gestellt wird (SPEC 19.7) */
  companyId: uuid("company_id"),
  /** Firmencode, mit dem gebucht wurde, und angewandter Rabatt (SPEC 19.29); der Rabatt steckt schon in den Zimmerpreisen */
  companyCodeId: uuid("company_code_id"),
  discountRappen: integer("discount_rappen").notNull().default(0),
  discountKind: text("discount_kind").$type<"company" | "gap">(),
  /** Direktvorteile zum Buchungszeitpunkt (Texte je Sprache), damit spätere Änderungen die Zusage nicht ändern */
  directBenefits: jsonb("direct_benefits").$type<Partial<Record<"de" | "en" | "fr" | "it" | "nl", string>>[]>().notNull().default([]),
  /** Erinnerungsmail nach abgebrochener Buchung gesendet */
  recoverySentAt: ts("recovery_sent_at"),
  adults: integer("adults").notNull(),
  children: integer("children").notNull().default(0),
  childrenAges: jsonb("children_ages").$type<number[]>().notNull().default([]),
  language: text("language").notNull().default("de"),
  guestId: uuid("guest_id"),
  roomsTotalRappen: integer("rooms_total_rappen").notNull().default(0),
  /** Zusatzleistungen (booking_extras), im total enthalten */
  extrasRappen: integer("extras_rappen").notNull().default(0),
  touristTaxRappen: integer("tourist_tax_rappen").notNull().default(0),
  totalRappen: integer("total_rappen").notNull().default(0),
  platformFeeRappen: integer("platform_fee_rappen").notNull().default(0),
  /** Restzahlung (SPEC 5.9): offener Betrag nach der Anzahlung, ohne Gutschein */
  balanceRappen: integer("balance_rappen").notNull().default(0),
  balanceDueOn: date("balance_due_on", { mode: "string" }),
  balancePaidAt: ts("balance_paid_at"),
  balanceOnsiteAt: ts("balance_onsite_at"),
  balanceRequestedAt: ts("balance_requested_at"),
  balanceRemindedAt: ts("balance_reminded_at"),
  balanceAlertedAt: ts("balance_alerted_at"),
  /** Gutschein bei der Online-Buchung: angerechneter Betrag (wird beim Hold abgezogen) */
  voucherId: uuid("voucher_id"),
  voucherRappen: integer("voucher_rappen").notNull().default(0),
  holdExpiresAt: ts("hold_expires_at"),
  confirmedAt: ts("confirmed_at"),
  cancelledAt: ts("cancelled_at"),
  cancelReason: text("cancel_reason"),
  channexBookingId: uuid("channex_booking_id").unique(),
  otaReservationCode: text("ota_reservation_code"),
  guestNotes: text("guest_notes"),
  /** Gruppe, zu der die Buchung gehört (SPEC 18.1) */
  groupId: uuid("group_id"),
  overbooked: boolean("overbooked").notNull().default(false),
  /** Datenübernahme (Migration 0057): Nummer in der bisherigen Software, je Betrieb eindeutig, und der Auftrag */
  sourceRef: text("source_ref"),
  importJobId: uuid("import_job_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type NightlyPrice = { night: string; price_rappen: number };

/** Zusatzleistungen des Hotels (Migration 0010) */
export const extras = pgTable("extras", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  name: jsonb("name").$type<L10n>().notNull().default({}),
  description: jsonb("description").$type<L10n>().notNull().default({}),
  priceRappen: integer("price_rappen").notNull(),
  unit: text("unit").$type<"per_booking" | "per_night" | "per_person" | "per_person_night">().notNull(),
  maxQuantity: integer("max_quantity").notNull().default(1),
  mandatory: boolean("mandatory").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  roomTypeIds: uuid("room_type_ids").array().notNull().default([]),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type Extra = typeof extras.$inferSelect;

export const bookingExtras = pgTable("booking_extras", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull(),
  hotelId: uuid("hotel_id").notNull(),
  extraId: uuid("extra_id"),
  name: jsonb("name").$type<L10n>().notNull(),
  unit: text("unit").notNull(),
  unitPriceRappen: integer("unit_price_rappen").notNull(),
  quantity: integer("quantity").notNull(),
  amountRappen: integer("amount_rappen").notNull(),
  position: integer("position").notNull().default(0),
});
export type BookingExtra = typeof bookingExtras.$inferSelect;

export const bookingRooms = pgTable("booking_rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull(),
  hotelId: uuid("hotel_id").notNull(),
  roomTypeId: uuid("room_type_id").notNull(),
  /** zugewiesenes Zimmer (SPEC 16.2), leer = nur Zimmertyp */
  roomId: uuid("room_id"),
  ratePlanId: uuid("rate_plan_id"),
  adults: integer("adults").notNull(),
  children: integer("children").notNull().default(0),
  nightlyPrices: jsonb("nightly_prices").$type<NightlyPrice[]>().notNull(),
  amountRappen: integer("amount_rappen").notNull(),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  bookingId: uuid("booking_id").notNull(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
  stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
  method: text("method"),
  amountRappen: integer("amount_rappen").notNull(),
  applicationFeeRappen: integer("application_fee_rappen").notNull().default(0),
  kind: text("kind").$type<"full" | "deposit" | "balance">().notNull().default("full"),
  refundedRappen: integer("refunded_rappen").notNull().default(0),
  status: text("status").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const inboundEvents = pgTable(
  "inbound_events",
  {
    source: text("source").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
    error: text("error"),
  },
  (t) => [primaryKey({ columns: [t.source, t.eventId] })],
);

/** Kanalverbindung (Booking.com) über die Channex Channel API (Migration 0015) */
export const channexChannels = pgTable("channex_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  channel: text("channel").$type<"BookingCom" | "Airbnb" | "Expedia">().notNull(),
  /** Hotel-ID bei Booking.com bzw. Expedia; bei Airbnb leer */
  externalId: text("external_id"),
  channexChannelId: uuid("channex_channel_id").unique(),
  status: text("status").$type<"draft" | "inactive" | "active">().notNull().default("draft"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  selection: jsonb("selection").$type<Record<string, string>>().notNull().default({}),
  mappings: jsonb("mappings").$type<unknown[]>().notNull().default([]),
  lastError: text("last_error"),
  /** Airbnb: Einmal-Token für den Rücksprung nach der Freigabe (Migration 0016) */
  authToken: text("auth_token"),
  authExpiresAt: ts("auth_expires_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const channexOutbox = pgTable("channex_outbox", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  hotelId: uuid("hotel_id").notNull(),
  kind: text("kind").notNull(),
  roomTypeId: uuid("room_type_id"),
  ratePlanId: uuid("rate_plan_id"),
  dateFrom: date("date_from", { mode: "string" }).notNull(),
  dateTo: date("date_to", { mode: "string" }).notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
  lastError: text("last_error"),
  taskId: text("task_id"),
  /** geänderte Restriktionsfelder; NULL = alle */
  fields: text("fields").array(),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
});

/** Gesperrte Empfänger (Postmark Bounce/Spam-Webhook). Plattformweit, deshalb ohne hotel_id. */
export const emailSuppressions = pgTable("email_suppressions", {
  email: text("email").primaryKey(),
  reason: text("reason").notNull(),
  bounceType: text("bounce_type"),
  details: text("details"),
  postmarkId: text("postmark_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const emailOutbox = pgTable("email_outbox", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  hotelId: uuid("hotel_id"),
  bookingId: uuid("booking_id"),
  template: text("template").notNull(),
  toEmail: text("to_email").notNull(),
  language: text("language").notNull().default("de"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  sendAfter: ts("send_after").notNull().defaultNow(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  sentAt: ts("sent_at"),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  hotelId: uuid("hotel_id"),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const touristTaxRules = pgTable("tourist_tax_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  canton: char("canton", { length: 2 }).notNull(),
  municipality: text("municipality").notNull(),
  validFrom: date("valid_from", { mode: "string" }).notNull(),
  category: text("category").notNull().default("hotel"),
  adultRappen: integer("adult_rappen"),
  reducedRappen: integer("reduced_rappen"),
  freeUnderAge: integer("free_under_age").notNull().default(0),
  reducedUnderAge: integer("reduced_under_age"),
  reportingSystem: text("reporting_system"),
  status: text("status").notNull(),
  notes: text("notes"),
  sourceUrl: text("source_url"),
  checkedAt: date("checked_at", { mode: "string" }).notNull(),
});

export const cantonRules = pgTable("canton_rules", {
  canton: char("canton", { length: 2 }).primaryKey(),
  retentionYears: integer("retention_years"),
  signatureRequired: boolean("signature_required").notNull().default(false),
  onlineReporting: text("online_reporting").notNull().default("none"),
  notes: text("notes"),
  sourceUrl: text("source_url"),
  groupListAllowed: boolean("group_list_allowed").notNull().default(false),
});

/** Gästeregister (SPEC 14, Migration 0008): *Enc-Felder sind mit src/lib/guest-crypto.ts verschlüsselt */
export const guestRegistrations = pgTable("guest_registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  bookingId: uuid("booking_id").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  listOnly: boolean("list_only").notNull().default(false),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  sex: text("sex"),
  birthDateEnc: text("birth_date_enc"),
  ageAtArrival: integer("age_at_arrival"),
  nationality: char("nationality", { length: 2 }),
  street: text("street"),
  postalCode: text("postal_code"),
  city: text("city"),
  country: char("country", { length: 2 }),
  idDocumentType: text("id_document_type"),
  idDocumentNumberEnc: text("id_document_number_enc"),
  vehiclePlate: text("vehicle_plate"),
  arrivalDate: date("arrival_date", { mode: "string" }).notNull(),
  departureDate: date("departure_date", { mode: "string" }).notNull(),
  roomLabel: text("room_label"),
  touristTaxLiable: boolean("tourist_tax_liable").notNull().default(true),
  signaturePngEnc: text("signature_png_enc"),
  confirmedByGuestAt: ts("confirmed_by_guest_at"),
  verifiedByStaffAt: ts("verified_by_staff_at"),
  retentionUntil: date("retention_until", { mode: "string" }).notNull(),
  exportedAt: ts("exported_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type GuestRegistration = typeof guestRegistrations.$inferSelect;

export type L10n = Partial<Record<"de" | "en" | "fr" | "it" | "nl", string>>;

export const sitePages = pgTable("site_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  slug: text("slug").notNull(),
  title: jsonb("title").$type<L10n>().notNull().default({}),
  navLabel: jsonb("nav_label").$type<L10n>().notNull().default({}),
  showInNav: boolean("show_in_nav").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  seo: jsonb("seo").$type<Partial<Record<"de" | "en" | "fr" | "it" | "nl", { title?: string; description?: string }>>>().notNull().default({}),
  blocks: jsonb("blocks").$type<import("../domain/blocks").Block[]>().notNull().default([]),
  published: boolean("published").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
export type SitePage = typeof sitePages.$inferSelect;

export type Hotel = typeof hotels.$inferSelect;
export type RoomType = typeof roomTypes.$inferSelect;
export type RatePlan = typeof ratePlans.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type TouristTaxRule = typeof touristTaxRules.$inferSelect;

export const inquiries = pgTable("inquiries", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  dateFrom: date("date_from", { mode: "string" }),
  dateTo: date("date_to", { mode: "string" }),
  persons: integer("persons"),
  timeOfDay: text("time_of_day"),
  message: text("message").notNull().default(""),
  language: text("language").notNull().default("de"),
  pageSlug: text("page_slug").notNull().default(""),
  status: text("status").notNull().default("new"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type Inquiry = typeof inquiries.$inferSelect;

export const vouchers = pgTable("vouchers", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  code: text("code").notNull().unique(),
  publicToken: text("public_token").notNull().unique(),
  amountRappen: integer("amount_rappen").notNull(),
  remainingRappen: integer("remaining_rappen").notNull(),
  platformFeeRappen: integer("platform_fee_rappen").notNull().default(0),
  buyerName: text("buyer_name").notNull(),
  buyerEmail: text("buyer_email").notNull(),
  recipientName: text("recipient_name").notNull().default(""),
  message: text("message").notNull().default(""),
  language: text("language").notNull().default("de"),
  status: text("status").notNull().default("pending"),
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  validUntil: date("valid_until", { mode: "string" }).notNull(),
  paidAt: ts("paid_at"),
  /** Datenübernahme (Migration 0058) */
  importJobId: uuid("import_job_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type Voucher = typeof vouchers.$inferSelect;

export const voucherRedemptions = pgTable("voucher_redemptions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  voucherId: uuid("voucher_id").notNull(),
  hotelId: uuid("hotel_id").notNull(),
  /** positiv = eingelöst, negativ = Gutschrift (Buchung abgelaufen oder storniert) */
  amountRappen: integer("amount_rappen").notNull(),
  bookingId: uuid("booking_id"),
  note: text("note").notNull().default(""),
  actor: text("actor").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const platformCharges = pgTable("platform_charges", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  month: text("month").notNull(),
  feesRappen: integer("fees_rappen").notNull(),
  minimumRappen: integer("minimum_rappen").notNull(),
  chargeRappen: integer("charge_rappen").notNull(),
  /** KI-Chat (SPEC 14b): Modulpreis und Zusatzpakete des Monats, in chargeRappen enthalten */
  aiModuleRappen: integer("ai_module_rappen").notNull().default(0),
  aiPacksRappen: integer("ai_packs_rappen").notNull().default(0),
  status: text("status").$type<"none" | "pending" | "succeeded" | "failed">().notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  /** Rechnung an das Hotel (SPEC 19.30): Wert aller Leistungen ohne MWST, MWST-Satz und -Betrag, Nummer und Datum; chargeRappen = bei der Karte noch zu belasten (inkl. MWST) */
  netRappen: integer("net_rappen").notNull().default(0),
  vatBps: integer("vat_bps").notNull().default(0),
  vatRappen: integer("vat_rappen").notNull().default(0),
  vatNumber: text("vat_number"),
  invoiceNo: text("invoice_no").unique(),
  invoiceDate: date("invoice_date", { mode: "string" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
export type PlatformCharge = typeof platformCharges.$inferSelect;


/** KI-Chat-Tarife (Migration 0020, SPEC 14b). pack_size 0 = keine Zusatzpakete */
export const aiPlans = pgTable("ai_plans", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  priceRappen: integer("price_rappen").notNull(),
  includedConversations: integer("included_conversations").notNull(),
  packSize: integer("pack_size").notNull().default(0),
  packPriceRappen: integer("pack_price_rappen").notNull().default(0),
  active: boolean("active").notNull().default(true),
  /** Tarif schaltet zusätzlich die KI-Preisempfehlung ein (KI-Zusatz) */
  includesPricing: boolean("includes_pricing").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type AiPlan = typeof aiPlans.$inferSelect;

/** Ein Gespräch (Sitzung) des KI-Chats, nur Zähler, nie Gesprächstexte */
export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  month: text("month").notNull(),
  surface: text("surface").$type<"site" | "booking">().notNull().default("site"),
  messages: integer("messages").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  /** Antworten, bei denen der Chat die Frage nicht beantworten konnte (Weiterleitungs-Hinweis), nur Zähler */
  unanswered: integer("unanswered").notNull().default(0),
  startedAt: ts("started_at").notNull().defaultNow(),
  lastAt: ts("last_at").notNull().defaultNow(),
});

/** Geräte (Browser/App) von Hotel-Mitarbeitenden für Push-Mitteilungen (Migration 0018) */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  userId: uuid("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const pushOutbox = pgTable("push_outbox", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  hotelId: uuid("hotel_id").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  url: text("url").notNull(),
  status: text("status").$type<"pending" | "sent" | "failed" | "cancelled">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
});

/** Überwachung (Migration 0022): Worker-Lebenszeichen und Alarm-Zeitpunkte */
export const systemStatus = pgTable("system_status", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const icalFeeds = pgTable("ical_feeds", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  roomTypeId: uuid("room_type_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  active: boolean("active").notNull().default(true),
  lastSyncedAt: ts("last_synced_at"),
  lastOkAt: ts("last_ok_at"),
  lastError: text("last_error"),
  lastConflicts: integer("last_conflicts").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const icalFeedNights = pgTable(
  "ical_feed_nights",
  {
    feedId: uuid("feed_id").notNull(),
    hotelId: uuid("hotel_id").notNull(),
    roomTypeId: uuid("room_type_id").notNull(),
    night: date("night", { mode: "string" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.feedId, t.night] })],
);

export const upsellItems = pgTable("upsell_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  name: jsonb("name").$type<L10n>().notNull().default({}),
  description: jsonb("description").$type<L10n>().notNull().default({}),
  priceRappen: integer("price_rappen").notNull(),
  unit: text("unit").$type<"per_booking" | "per_night" | "per_person" | "per_person_night">().notNull(),
  maxQuantity: integer("max_quantity").notNull().default(1),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type UpsellItem = typeof upsellItems.$inferSelect;

export const upsellOrders = pgTable("upsell_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  bookingId: uuid("booking_id").notNull(),
  lines: jsonb("lines").$type<{ name: L10n; quantity: number; amountRappen: number }[]>().notNull(),
  amountRappen: integer("amount_rappen").notNull(),
  feeRappen: integer("fee_rappen").notNull(),
  feeBps: integer("fee_bps").notNull(),
  source: text("source").notNull().default("email"),
  status: text("status").$type<"pending" | "paid" | "cancelled">().notNull().default("pending"),
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  paidAt: ts("paid_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type UpsellOrder = typeof upsellOrders.$inferSelect;

export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  roomTypeId: uuid("room_type_id").notNull(),
  number: text("number").notNull(),
  floor: text("floor").notNull().default(""),
  note: text("note").notNull().default(""),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Reinigungsstatus (SPEC 17.1) */
  cleanStatus: text("clean_status").$type<"dirty" | "clean" | "inspected">().notNull().default("clean"),
  statusChangedAt: ts("status_changed_at"),
  statusChangedBy: text("status_changed_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type Room = typeof rooms.$inferSelect;

export const guestProfiles = pgTable("guest_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  email: text("email").notNull(),
  note: text("note").notNull().default(""),
  tags: text("tags").array().notNull().default([]),
  updatedBy: text("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
export type GuestProfile = typeof guestProfiles.$inferSelect;

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  name: text("name").notNull(),
  company: text("company").notNull().default(""),
  contactName: text("contact_name").notNull().default(""),
  contactEmail: text("contact_email").notNull().default(""),
  street: text("street").notNull().default(""),
  zip: text("zip").notNull().default(""),
  city: text("city").notNull().default(""),
  arrival: date("arrival", { mode: "string" }).notNull(),
  departure: date("departure", { mode: "string" }).notNull(),
  releaseOn: date("release_on", { mode: "string" }),
  status: text("status").$type<"active" | "released" | "cancelled">().notNull().default("active"),
  note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type Group = typeof groups.$inferSelect;

export const groupBlockDays = pgTable("group_block_days", {
  groupId: uuid("group_id").notNull(),
  roomTypeId: uuid("room_type_id").notNull(),
  night: date("night", { mode: "string" }).notNull(),
  rooms: integer("rooms").notNull(),
}, (t) => [primaryKey({ columns: [t.groupId, t.roomTypeId, t.night] })]);

export const housekeepingTasks = pgTable("housekeeping_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  roomId: uuid("room_id").notNull(),
  bookingId: uuid("booking_id"),
  kind: text("kind").$type<"checkout" | "stay" | "other">().notNull(),
  day: date("day", { mode: "string" }).notNull(),
  status: text("status").$type<"open" | "done">().notNull().default("open"),
  note: text("note").notNull().default(""),
  doneAt: ts("done_at"),
  doneBy: text("done_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type HousekeepingTask = typeof housekeepingTasks.$inferSelect;

export const roomIssues = pgTable("room_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  roomId: uuid("room_id").notNull(),
  description: text("description").notNull(),
  status: text("status").$type<"open" | "done">().notNull().default("open"),
  reportedBy: text("reported_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  doneAt: ts("done_at"),
  doneBy: text("done_by"),
});
export type RoomIssue = typeof roomIssues.$inferSelect;

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  bookingId: uuid("booking_id"),
  kind: text("kind").$type<"invoice" | "credit_note">().notNull().default("invoice"),
  status: text("status").$type<"draft" | "issued">().notNull().default("draft"),
  number: text("number"),
  issuedOn: date("issued_on", { mode: "string" }),
  dueOn: date("due_on", { mode: "string" }),
  recipient: jsonb("recipient").$type<InvoiceRecipient>().notNull().default({}),
  /** Firmenkunde (SPEC 19.7), Rechnung auf Rechnung */
  companyId: uuid("company_id"),
  creditOf: uuid("credit_of"),
  totalRappen: integer("total_rappen").notNull().default(0),
  vatRappen: integer("vat_rappen").notNull().default(0),
  note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  issuedAt: ts("issued_at"),
  emailedAt: ts("emailed_at"),
});
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceRecipient = { name?: string; company?: string; street?: string; zip?: string; city?: string; country?: string; vatId?: string; email?: string };

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull(),
  hotelId: uuid("hotel_id").notNull(),
  position: integer("position").notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPriceRappen: integer("unit_price_rappen").notNull(),
  amountRappen: integer("amount_rappen").notNull(),
  vatBps: integer("vat_bps").notNull().default(0),
  category: text("category").$type<"stay" | "extra" | "tax" | "discount" | "other">().notNull().default("other"),
});
export type InvoiceLine = typeof invoiceLines.$inferSelect;

export const folioItems = pgTable("folio_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  bookingId: uuid("booking_id").notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPriceRappen: integer("unit_price_rappen").notNull(),
  vatKind: text("vat_kind").$type<"stay" | "standard" | "none">().notNull().default("standard"),
  invoiceId: uuid("invoice_id"),
  /** Beleg-ID der fremden Kasse (PosBridge, SPEC 19.15), eindeutig je Betrieb */
  externalId: text("external_id"),
  source: text("source"),
  /** MWST-Satz in Basispunkten, wenn er von der Art abweicht (Restaurant: 2,6 % Take-away usw., SPEC 19.16) */
  vatBpsOverride: integer("vat_bps_override"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type FolioItem = typeof folioItems.$inferSelect;

export const onsitePayments = pgTable("onsite_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  bookingId: uuid("booking_id").notNull(),
  amountRappen: integer("amount_rappen").notNull(),
  method: text("method").$type<"cash" | "card" | "twint" | "bank" | "other">().notNull(),
  note: text("note").notNull().default(""),
  receivedOn: date("received_on", { mode: "string" }).notNull(),
  actor: text("actor").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type OnsitePayment = typeof onsitePayments.$inferSelect;

export const terminalReaders = pgTable("terminal_readers", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  stripeReaderId: text("stripe_reader_id").notNull().unique(),
  stripeLocationId: text("stripe_location_id").notNull(),
  label: text("label").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type TerminalReader = typeof terminalReaders.$inferSelect;

export const terminalPayments = pgTable("terminal_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  bookingId: uuid("booking_id").notNull(),
  readerId: uuid("reader_id").notNull(),
  paymentIntentId: text("payment_intent_id").unique(),
  amountRappen: integer("amount_rappen").notNull(),
  status: text("status").$type<"pending" | "succeeded" | "failed" | "canceled">().notNull().default("pending"),
  failureCode: text("failure_code"),
  onsitePaymentId: uuid("onsite_payment_id"),
  actor: text("actor").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
export type TerminalPayment = typeof terminalPayments.$inferSelect;

export const doorLocks = pgTable("door_locks", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  nukiSmartlockId: bigint("nuki_smartlock_id", { mode: "number" }).notNull(),
  name: text("name").notNull(),
  roomId: uuid("room_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type DoorLock = typeof doorLocks.$inferSelect;

export const doorCodes = pgTable("door_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  bookingId: uuid("booking_id").notNull(),
  lockId: uuid("lock_id").notNull(),
  codeEnc: text("code_enc").notNull(),
  authName: text("auth_name").notNull(),
  nukiAuthId: text("nuki_auth_id"),
  status: text("status").$type<"pending" | "active" | "revoked" | "expired" | "error">().notNull().default("pending"),
  error: text("error"),
  validFrom: ts("valid_from").notNull(),
  validUntil: ts("valid_until").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
export type DoorCode = typeof doorCodes.$inferSelect;

export const userPasskeys = pgTable("user_passkeys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: text("transports"),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at"),
});

export const userTotp = pgTable("user_totp", {
  userId: uuid("user_id").primaryKey(),
  secretEnc: text("secret_enc").notNull(),
  confirmedAt: ts("confirmed_at"),
  lastStep: bigint("last_step", { mode: "number" }).notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const userRecoveryCodes = pgTable("user_recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  codeHash: text("code_hash").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});

export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const emailChanges = pgTable("email_changes", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull(),
  newEmail: text("new_email").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type DayTotals = {
  /** Zahlungen vor Ort nach Zahlungsart (Rappen, Rückzahlungen negativ) */
  onsite: Record<string, number>;
  /** Online-Zahlungen über Stripe, an diesem Tag eingegangen (Rappen) */
  online: number;
  /** Rechnungen und Gutschriften, an diesem Tag ausgestellt */
  invoices: { count: number; creditNotes: number; grossRappen: number; vatByBps: Record<string, number> };
};
export const dayCloses = pgTable("day_closes", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  day: date("day", { mode: "string" }).notNull(),
  totals: jsonb("totals").$type<DayTotals>().notNull(),
  cashExpectedRappen: integer("cash_expected_rappen").notNull().default(0),
  cashCountedRappen: integer("cash_counted_rappen"),
  differenceRappen: integer("difference_rappen").notNull().default(0),
  note: text("note").notNull().default(""),
  closedBy: text("closed_by").notNull(),
  closedAt: ts("closed_at").notNull().defaultNow(),
});
export type DayClose = typeof dayCloses.$inferSelect;

export const stayFeedback = pgTable("stay_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  bookingId: uuid("booking_id").notNull().unique(),
  score: integer("score").notNull(),
  comment: text("comment").notNull().default(""),
  publicLinkShown: boolean("public_link_shown").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type StayFeedback = typeof stayFeedback.$inferSelect;

export type OccupancyStep = { fromPct: number; bps: number };
export type LastMinuteRule = { withinDays: number; belowPct: number; bps: number };
export const pricingRules = pgTable("pricing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  ratePlanId: uuid("rate_plan_id").notNull().unique(),
  baseRappen: integer("base_rappen").notNull(),
  minRappen: integer("min_rappen").notNull(),
  maxRappen: integer("max_rappen").notNull(),
  occupancySteps: jsonb("occupancy_steps").$type<OccupancyStep[]>().notNull().default([]),
  lastMinute: jsonb("last_minute").$type<LastMinuteRule | null>(),
  /** Zuschlag in Basispunkten je Wochentag, Index 0 = Sonntag */
  weekdayBps: jsonb("weekday_bps").$type<number[]>().notNull().default([0, 0, 0, 0, 0, 0, 0]),
  autoApply: boolean("auto_apply").notNull().default(false),
  active: boolean("active").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
export type PricingRule = typeof pricingRules.$inferSelect;

export const pricingEvents = pgTable("pricing_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  name: text("name").notNull(),
  fromDay: date("from_day", { mode: "string" }).notNull(),
  toDay: date("to_day", { mode: "string" }).notNull(),
  adjustBps: integer("adjust_bps").notNull(),
});
export type PricingEvent = typeof pricingEvents.$inferSelect;

export const pricingProposals = pgTable("pricing_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  ratePlanId: uuid("rate_plan_id").notNull(),
  night: date("night", { mode: "string" }).notNull(),
  currentRappen: integer("current_rappen").notNull(),
  proposedRappen: integer("proposed_rappen").notNull(),
  reason: text("reason").notNull(),
  status: text("status").$type<"open" | "applied" | "dismissed">().notNull().default("open"),
  /** Herkunft: nach Regeln oder KI-Empfehlung (Migration 0059) */
  source: text("source").$type<"rules" | "ai">().notNull().default("rules"),
  createdAt: ts("created_at").notNull().defaultNow(),
  decidedAt: ts("decided_at"),
  decidedBy: text("decided_by"),
});
export type PricingProposal = typeof pricingProposals.$inferSelect;

export const roomMoves = pgTable("room_moves", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  bookingRoomId: uuid("booking_room_id").notNull(),
  fromRoomId: uuid("from_room_id").notNull(),
  toRoomId: uuid("to_room_id").notNull(),
  moveDay: date("move_day", { mode: "string" }).notNull(),
  reason: text("reason").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type RoomMove = typeof roomMoves.$inferSelect;

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  name: text("name").notNull(),
  street: text("street").notNull().default(""),
  zip: text("zip").notNull().default(""),
  city: text("city").notNull().default(""),
  country: text("country").notNull().default("CH"),
  vatId: text("vat_id").notNull().default(""),
  email: text("email").notNull().default(""),
  /** Zahlungsfrist in Tagen, leer = Einstellung des Betriebs */
  paymentDays: integer("payment_days"),
  note: text("note").notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type Company = typeof companies.$inferSelect;

/** Firmencode (SPEC 19.29): Rabatt und optional Rechnung für eine Firma, im Buchungsfenster einzugeben */
export const companyCodes = pgTable("company_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  discountBps: integer("discount_bps").notNull().default(0),
  payOnInvoice: boolean("pay_on_invoice").notNull().default(false),
  validFrom: date("valid_from", { mode: "string" }),
  validUntil: date("valid_until", { mode: "string" }),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type CompanyCode = typeof companyCodes.$inferSelect;

/** Warteliste (SPEC 19.29): Gast wird benachrichtigt, sobald für seine Daten etwas frei ist */
export const waitlistEntries = pgTable("waitlist_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  language: text("language").notNull().default("de"),
  checkin: date("checkin", { mode: "string" }).notNull(),
  checkout: date("checkout", { mode: "string" }).notNull(),
  adults: integer("adults").notNull().default(2),
  children: integer("children").notNull().default(0),
  childAges: integer("child_ages").array().notNull().default([]),
  token: text("token").notNull().unique(),
  status: text("status").$type<"waiting" | "notified" | "cancelled" | "expired">().notNull().default("waiting"),
  notifiedAt: ts("notified_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type WaitlistEntry = typeof waitlistEntries.$inferSelect;

export const invoiceDunnings = pgTable("invoice_dunnings", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  level: integer("level").notNull(),
  sentOn: date("sent_on", { mode: "string" }).notNull(),
  sentTo: text("sent_to").notNull(),
  sentBy: text("sent_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const bankEntries = pgTable("bank_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  bookedOn: date("booked_on", { mode: "string" }).notNull(),
  amountRappen: integer("amount_rappen").notNull(),
  reference: text("reference").notNull().default(""),
  invoiceId: uuid("invoice_id"),
  status: text("status").$type<"matched" | "unmatched" | "ignored">().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const inboxThreads = pgTable("inbox_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  channexThreadId: text("channex_thread_id").notNull().unique(),
  bookingId: uuid("booking_id"),
  provider: text("provider").notNull().default(""),
  title: text("title").notNull().default(""),
  isClosed: boolean("is_closed").notNull().default(false),
  unread: integer("unread").notNull().default(0),
  lastMessage: text("last_message").notNull().default(""),
  lastMessageAt: ts("last_message_at").notNull().defaultNow(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type InboxThread = typeof inboxThreads.$inferSelect;

export const inboxMessages = pgTable("inbox_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  threadId: uuid("thread_id").notNull(),
  channexMessageId: text("channex_message_id").notNull(),
  sender: text("sender").notNull(),
  body: text("body").notNull().default(""),
  attachments: jsonb("attachments").$type<unknown[]>().notNull().default([]),
  sentBy: text("sent_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type InboxMessage = typeof inboxMessages.$inferSelect;

export const owners = pgTable("owners", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull().default(""),
  commissionBps: integer("commission_bps").notNull().default(0),
  roomTypeIds: uuid("room_type_ids").array().notNull().default([]),
  note: text("note").notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type Owner = typeof owners.$inferSelect;

export const ownerCosts = pgTable("owner_costs", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  ownerId: uuid("owner_id").notNull(),
  month: text("month").notNull(),
  description: text("description").notNull(),
  amountRappen: integer("amount_rappen").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type OwnerCost = typeof ownerCosts.$inferSelect;

export const ownerStatements = pgTable("owner_statements", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  ownerId: uuid("owner_id").notNull(),
  month: text("month").notNull(),
  revenueRappen: integer("revenue_rappen").notNull(),
  commissionRappen: integer("commission_rappen").notNull(),
  costsRappen: integer("costs_rappen").notNull(),
  netRappen: integer("net_rappen").notNull(),
  sentTo: text("sent_to").notNull(),
  sentAt: ts("sent_at").notNull().defaultNow(),
});

export const resources = pgTable("resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").$type<"wellness" | "seminar" | "sport" | "other">().notNull().default("other"),
  capacity: integer("capacity").notNull().default(1),
  slotMinutes: integer("slot_minutes").notNull().default(60),
  /** Öffnungszeit in Minuten ab Mitternacht */
  openFrom: integer("open_from").notNull().default(480),
  openTo: integer("open_to").notNull().default(1200),
  priceRappen: integer("price_rappen").notNull().default(0),
  pricePerPerson: boolean("price_per_person").notNull().default(false),
  vatKind: text("vat_kind").$type<"stay" | "standard" | "none">().notNull().default("standard"),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type Resource = typeof resources.$inferSelect;

export const resourceBookings = pgTable("resource_bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  resourceId: uuid("resource_id").notNull(),
  bookingId: uuid("booking_id"),
  folioItemId: uuid("folio_item_id"),
  guestName: text("guest_name").notNull(),
  day: date("day", { mode: "string" }).notNull(),
  startMin: integer("start_min").notNull(),
  endMin: integer("end_min").notNull(),
  persons: integer("persons").notNull(),
  priceRappen: integer("price_rappen").notNull(),
  status: text("status").$type<"confirmed" | "cancelled">().notNull().default("confirmed"),
  note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type ResourceBooking = typeof resourceBookings.$inferSelect;

export type NewsletterSegment = { language?: string; tag?: string; stayedSince?: string; minStays?: number };
export const newsletters = pgTable("newsletters", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  segment: jsonb("segment").$type<NewsletterSegment>().notNull().default({}),
  status: text("status").$type<"draft" | "sent">().notNull().default("draft"),
  recipients: integer("recipients").notNull().default(0),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
});
export type Newsletter = typeof newsletters.$inferSelect;

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  label: text("label").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  /** pos = Kassen-Schnittstelle, website = Buchungs-API für die eigene Website */
  scope: text("scope").$type<"pos" | "website">().notNull().default("pos"),
  /** optionaler Ablauf und optionale Liste erlaubter IP-Adressen (leer = alle) */
  expiresAt: ts("expires_at"),
  allowedIps: text("allowed_ips").array().notNull().default([]),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
});
export type ApiKey = typeof apiKeys.$inferSelect;

// ---------------------------------------------------------------- Restaurant und Kasse (SPEC 19.16)
export const posItems = pgTable("pos_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  category: text("category").notNull().default(""),
  name: text("name").notNull(),
  priceRappen: integer("price_rappen").notNull(),
  vatDineInBps: integer("vat_dine_in_bps").notNull().default(810),
  vatTakeawayBps: integer("vat_takeaway_bps").notNull().default(810),
  dailySpecial: boolean("daily_special").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type PosItem = typeof posItems.$inferSelect;

export const posTables = pgTable("pos_tables", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});
export type PosTable = typeof posTables.$inferSelect;

export const posDevices = pgTable("pos_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  code: text("code").notNull(),
  label: text("label").notNull().default(""),
  lastBon: integer("last_bon").notNull().default(0),
  claimedKey: text("claimed_key"),
  lastSeenAt: ts("last_seen_at"),
  pendingOps: integer("pending_ops").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type PosDevice = typeof posDevices.$inferSelect;

export const posOrders = pgTable("pos_orders", {
  id: uuid("id").primaryKey(),
  hotelId: uuid("hotel_id").notNull(),
  tableId: uuid("table_id"),
  deviceId: uuid("device_id"),
  label: text("label").notNull().default(""),
  openedBy: text("opened_by").notNull(),
  openedAt: ts("opened_at").notNull().defaultNow(),
  deviceAt: ts("device_at"),
});
export type PosOrder = typeof posOrders.$inferSelect;

export const posOrderLines = pgTable("pos_order_lines", {
  id: uuid("id").primaryKey(),
  hotelId: uuid("hotel_id").notNull(),
  orderId: uuid("order_id").notNull(),
  itemId: uuid("item_id"),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceRappen: integer("unit_price_rappen").notNull(),
  vatBps: integer("vat_bps").notNull(),
  mode: text("mode").$type<"dine_in" | "takeaway">().notNull().default("dine_in"),
  reversesLineId: uuid("reverses_line_id"),
  reason: text("reason").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  deviceAt: ts("device_at"),
});
export type PosOrderLine = typeof posOrderLines.$inferSelect;

export type PosReceiptItem = { lineId: string; description: string; quantity: number; unitPriceRappen: number; vatBps: number };
export type PosVatRow = { bps: number; grossRappen: number; vatRappen: number; netRappen: number };
export const posReceipts = pgTable("pos_receipts", {
  id: uuid("id").primaryKey(),
  hotelId: uuid("hotel_id").notNull(),
  orderId: uuid("order_id").notNull(),
  deviceId: uuid("device_id").notNull(),
  bonNo: integer("bon_no").notNull(),
  number: text("number").notNull(),
  seq: bigint("seq", { mode: "number" }).notNull(),
  kind: text("kind").$type<"sale" | "reversal">().notNull().default("sale"),
  reversesReceiptId: uuid("reverses_receipt_id"),
  items: jsonb("items").$type<PosReceiptItem[]>().notNull(),
  totalRappen: integer("total_rappen").notNull(),
  vat: jsonb("vat").$type<PosVatRow[]>().notNull(),
  tipRappen: integer("tip_rappen").notNull().default(0),
  businessDay: date("business_day", { mode: "string" }).notNull(),
  late: boolean("late").notNull().default(false),
  cashier: text("cashier").notNull(),
  paidAt: ts("paid_at").notNull().defaultNow(),
  deviceAt: ts("device_at"),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
});
export type PosReceipt = typeof posReceipts.$inferSelect;

export const posPayments = pgTable("pos_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  receiptId: uuid("receipt_id").notNull(),
  method: text("method").$type<"cash" | "card" | "twint" | "room">().notNull(),
  amountRappen: integer("amount_rappen").notNull(),
  bookingId: uuid("booking_id"),
  folioItemIds: uuid("folio_item_ids").array().notNull().default([]),
});
export type PosPayment = typeof posPayments.$inferSelect;

export const posDayCloses = pgTable("pos_day_closes", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  day: date("day", { mode: "string" }).notNull(),
  report: jsonb("report").$type<Record<string, unknown>>().notNull(),
  countedCashRappen: integer("counted_cash_rappen").notNull(),
  differenceRappen: integer("difference_rappen").notNull(),
  note: text("note").notNull().default(""),
  closedBy: text("closed_by").notNull(),
  closedAt: ts("closed_at").notNull().defaultNow(),
});
export type PosDayClose = typeof posDayCloses.$inferSelect;

export const onboardingTasks = pgTable(
  "onboarding_tasks",
  {
    hotelId: uuid("hotel_id").notNull(),
    userId: uuid("user_id").notNull(),
    taskKey: text("task_key").notNull(),
    doneAt: ts("done_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.hotelId, t.userId, t.taskKey] })],
);

/** Datenübernahme aus der bisherigen Software (Migration 0057, PMS-ERSATZ E1) */
export type ImportSummary = {
  kind?: "reservations" | "guests" | "vouchers";
  total: number; created: number; skipped: number; errors: number; warnings: number; past: number; future: number;
  issues: { row: number; severity: "error" | "warn"; message: string }[];
  sample: { row: number; ref: string; guest: string; checkin: string; checkout: string }[];
  undone?: { removed: number; kept: { ref: string; reason: string }[] };
};
export const importJobs = pgTable("import_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  sourceProfile: text("source_profile").notNull().default("generic"),
  status: text("status").$type<"checked" | "running" | "done" | "undone" | "failed">().notNull(),
  filename: text("filename").notNull().default(""),
  csv: text("csv"),
  summary: jsonb("summary").$type<ImportSummary>().notNull().default({} as ImportSummary),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
});
export type ImportJob = typeof importJobs.$inferSelect;

/** KI-Preisempfehlung: ein Lauf je Aufruf, nur Zähler (Migration 0059) */
export const aiPricingRuns = pgTable("ai_pricing_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  day: date("day", { mode: "string" }).notNull(),
  status: text("status").$type<"ok" | "error">().notNull(),
  model: text("model").notNull(),
  nights: integer("nights").notNull().default(0),
  proposals: integer("proposals").notNull().default(0),
  rejected: integer("rejected").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Angebot aus einer Anfrage (Seminar, Gruppe, Fest). Preise brutto in Rappen. */
export const offers = pgTable("offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  inquiryId: uuid("inquiry_id"),
  seq: integer("seq").notNull(),
  publicToken: text("public_token").notNull().unique(),
  status: text("status").$type<"draft" | "sent" | "accepted" | "declined" | "expired">().notNull().default("draft"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  company: text("company").notNull().default(""),
  title: text("title").notNull(),
  intro: text("intro").notNull().default(""),
  language: text("language").notNull().default("de"),
  validUntil: date("valid_until", { mode: "string" }).notNull(),
  sentAt: ts("sent_at"),
  decidedAt: ts("decided_at"),
  decisionNote: text("decision_note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type Offer = typeof offers.$inferSelect;

export const offerLines = pgTable("offer_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  offerId: uuid("offer_id").notNull(),
  hotelId: uuid("hotel_id").notNull(),
  position: integer("position").notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitRappen: integer("unit_rappen").notNull(),
  vatKind: text("vat_kind").$type<"stay" | "standard" | "none">().notNull().default("standard"),
  resourceId: uuid("resource_id"),
  day: date("day", { mode: "string" }),
  startMin: integer("start_min"),
  endMin: integer("end_min"),
  persons: integer("persons"),
  resourceBookingId: uuid("resource_booking_id"),
});
export type OfferLine = typeof offerLines.$inferSelect;

// ---------------------------------------------------------------- Website-Schnittstelle: Idempotenz und Webhooks (SPEC 19.22)
export const apiIdempotency = pgTable("api_idempotency", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  keyId: uuid("key_id").notNull(),
  idemKey: text("idem_key").notNull(),
  requestHash: text("request_hash").notNull(),
  statusCode: integer("status_code"),
  response: jsonb("response").$type<unknown>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  url: text("url").notNull(),
  secretEnc: text("secret_enc").notNull(),
  events: text("events").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  endpointId: uuid("endpoint_id").notNull(),
  event: text("event").notNull(),
  eventId: uuid("event_id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<"pending" | "sent" | "failed">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
  lastStatus: integer("last_status"),
  lastError: text("last_error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
});
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

/** Gerätekennung der nativen App myPontivo für Mitteilungen (SPEC 19.23) */
export const nativePushTokens = pgTable("native_push_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  userId: uuid("user_id").notNull(),
  platform: text("platform").$type<"android" | "ios">().notNull(),
  token: text("token").notNull(),
  appVersion: text("app_version"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Eigene Rollen eines Betriebs: Name und freigegebene Seiten (Menü-Schlüssel); Mitglieder mit role = 'custom:<id>' */
export const hotelRoles = pgTable("hotel_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  hotelId: uuid("hotel_id").notNull(),
  name: text("name").notNull(),
  areas: text("areas").array().notNull().default([]),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Angepasste Standardrollen eines Betriebs (Name und Seiten); ohne Zeile gelten die Vorgaben aus src/domain/roles.ts */
export const hotelRoleOverrides = pgTable(
  "hotel_role_overrides",
  {
    hotelId: uuid("hotel_id").notNull(),
    role: text("role").notNull(),
    name: text("name"),
    areas: text("areas").array().notNull().default([]),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.hotelId, t.role] })],
);

/** Vertriebs-Cockpit (SPEC 19.31): Interessenten der Plattform */
export const salesLeads = pgTable("sales_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  contactName: text("contact_name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  website: text("website").notNull().default(""),
  canton: char("canton", { length: 2 }),
  source: text("source").$type<"manuell" | "registrierung" | "empfehlung" | "messe" | "anfrage">().notNull().default("manuell"),
  status: text("status").$type<"neu" | "kontaktiert" | "demo" | "angebot" | "gewonnen" | "verloren">().notNull().default("neu"),
  notes: text("notes").notNull().default(""),
  nextActionAt: date("next_action_at", { mode: "string" }),
  hotelId: uuid("hotel_id"),
  doNotContact: boolean("do_not_contact").notNull().default(false),
  lastMailAt: ts("last_mail_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
export type SalesLead = typeof salesLeads.$inferSelect;

export const salesLeadEvents = pgTable("sales_lead_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  leadId: uuid("lead_id").notNull(),
  kind: text("kind").$type<"created" | "status" | "mail" | "note">().notNull(),
  text: text("text").notNull().default(""),
  actor: text("actor").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
