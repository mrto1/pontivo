/**
 * Drizzle-Abbild von db/migrations/*.sql (Quelle der Wahrheit bleibt SQL, SPEC 2).
 * Bei Schemaänderungen: neue Datei in db/migrations/ UND diese Datei nachführen.
 */
import { sql } from "drizzle-orm";
import { DEFAULT_PLATFORM_FEE_BPS } from "../domain/fee";
import {
  pgTable, uuid, text, char, integer, boolean, timestamp, time, date, jsonb, bigserial, primaryKey,
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
  onboarding: jsonb("onboarding").$type<{ startedAt?: string; completedAt?: string; reminders?: number; alertedAt?: string; embeddedAt?: string }>().notNull().default({}),
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
  /** Dokumente (PDF) für den Baustein «Downloads», z. B. Speisekarte, Preisliste */
  documents?: HotelDocument[];
  /** Erscheinungsbild der Buchungsseite */
  brand?: HotelBrand;
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
  overbooked: boolean("overbooked").notNull().default(false),
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
