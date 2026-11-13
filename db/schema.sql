-- schema.sql — Buchungsplattform v1 (PostgreSQL 16)
-- Konventionen: Beträge in Rappen (integer), Kalendertage als DATE (ohne Zeitzone),
-- Zeitpunkte als TIMESTAMPTZ (UTC). Jede fachliche Tabelle trägt hotel_id (Mandant).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Mandanten und Benutzer ----------
CREATE TABLE hotels (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                   text NOT NULL UNIQUE,              -- für /h/<slug> und interne URLs
  name                   text NOT NULL,
  legal_name             text,
  address_line           text,
  postal_code            text,
  city                   text,
  canton                 char(2) NOT NULL,                  -- 'SG','TG','GL','AR','AI', ...
  municipality           text,                              -- für Kurtaxe-Regeln
  primary_domain         text UNIQUE,                       -- z. B. 'www.hotel1.ch'
  currency               char(3) NOT NULL DEFAULT 'CHF',
  timezone               text NOT NULL DEFAULT 'Europe/Zurich',
  default_language       text NOT NULL DEFAULT 'de',
  contact_email          text NOT NULL,
  contact_phone          text,
  platform_fee_bps       integer NOT NULL DEFAULT 190,      -- 190 bps = 1,9 % (Migration 0019)
  -- Kurtaxe: Regel kommt aus tourist_tax_rules (canton + municipality, gültig am Anreisetag).
  tourist_tax_included_in_price boolean NOT NULL DEFAULT false,
  tourist_tax_category text NOT NULL DEFAULT 'hotel' CHECK (tourist_tax_category IN ('hotel','group')),
  checkin_time           time NOT NULL DEFAULT '15:00',
  checkout_time          time NOT NULL DEFAULT '11:00',
  stripe_account_id      text UNIQUE,
  stripe_charges_enabled boolean NOT NULL DEFAULT false,
  stripe_twint_active    boolean NOT NULL DEFAULT false,
  channex_property_id    uuid UNIQUE,
  channex_enabled        boolean NOT NULL DEFAULT false,
  status                 text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','paused')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  name        text,
  is_platform_admin boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hotel_members (
  hotel_id    uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner','manager','staff')),
  PRIMARY KEY (hotel_id, user_id)
);

CREATE TABLE hotel_modules (
  hotel_id    uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  module      text NOT NULL CHECK (module IN ('guests','invoicing','housekeeping','reports','groups')),
  enabled     boolean NOT NULL DEFAULT false,
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (hotel_id, module)
);

-- ---------- Zimmer und Preise ----------
CREATE TABLE room_types (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id             uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  description          text,
  max_adults           integer NOT NULL CHECK (max_adults > 0),
  max_children         integer NOT NULL DEFAULT 0,
  max_occupancy        integer NOT NULL CHECK (max_occupancy > 0),
  room_count           integer NOT NULL CHECK (room_count >= 0),   -- Anzahl physischer Zimmer dieses Typs
  photos               jsonb NOT NULL DEFAULT '[]'::jsonb,           -- [{url, alt}]
  sort_order           integer NOT NULL DEFAULT 0,
  channex_room_type_id uuid UNIQUE,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON room_types(hotel_id);

CREATE TABLE rate_plans (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id             uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_type_id         uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  name                 text NOT NULL,                        -- z. B. 'Flexibel', 'Nicht stornierbar'
  breakfast_included   boolean NOT NULL DEFAULT true,
  -- Stornoregel: kostenlos bis free_cancel_hours vor Anreise (Check-in-Zeit, Hotelzeitzone),
  -- danach wird cancel_fee_bps vom Zimmerpreis einbehalten. Nicht stornierbar: free_cancel_hours = NULL, cancel_fee_bps = 10000.
  free_cancel_hours    integer,
  cancel_fee_bps       integer NOT NULL DEFAULT 10000 CHECK (cancel_fee_bps BETWEEN 0 AND 10000),
  base_occupancy       integer NOT NULL DEFAULT 2,           -- Preis in rates_days gilt für diese Personenzahl
  extra_adult_rappen   integer NOT NULL DEFAULT 0,           -- pro Nacht und zusätzlicher erwachsener Person
  single_discount_rappen integer NOT NULL DEFAULT 0,         -- pro Nacht bei 1 Person
  channex_rate_plan_id uuid UNIQUE,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON rate_plans(hotel_id);
CREATE INDEX ON rate_plans(room_type_id);

-- Verfügbarkeit pro Zimmertyp und Nacht. available = room_count - booked - blocked (wird gespeichert, nicht berechnet).
CREATE TABLE inventory_days (
  hotel_id      uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_type_id  uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  night         date NOT NULL,                 -- Nacht = Datum der Anreise dieser Nacht
  total         integer NOT NULL CHECK (total >= 0),
  booked        integer NOT NULL DEFAULT 0 CHECK (booked >= 0),   -- inkl. Holds
  blocked       integer NOT NULL DEFAULT 0 CHECK (blocked >= 0),  -- vom Hotel gesperrt / ausser Betrieb
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_type_id, night)
  -- Bewusst KEIN Check booked + blocked <= total: OTA-Buchungen dürfen eine Überbuchung erzeugen,
  -- damit sie sichtbar wird (SPEC 5.6). Direktbuchungen prüfen die Grenze in der Transaktion.
);
CREATE INDEX ON inventory_days(hotel_id, night);

-- Preis und Regeln pro Rateplan und Nacht.
CREATE TABLE rates_days (
  hotel_id            uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  rate_plan_id        uuid NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  night               date NOT NULL,
  price_rappen        integer NOT NULL CHECK (price_rappen > 0),
  min_stay_arrival    integer NOT NULL DEFAULT 1 CHECK (min_stay_arrival >= 1),
  max_stay            integer,
  closed_to_arrival   boolean NOT NULL DEFAULT false,
  closed_to_departure boolean NOT NULL DEFAULT false,
  stop_sell           boolean NOT NULL DEFAULT false,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_plan_id, night)
);
CREATE INDEX ON rates_days(hotel_id, night);

-- ---------- Gäste und Buchungen ----------
CREATE TABLE guests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  email           text NOT NULL,
  phone           text,
  language        text NOT NULL DEFAULT 'de',
  marketing_consent boolean NOT NULL DEFAULT false,
  marketing_consent_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON guests(hotel_id, email);

CREATE TABLE bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id           uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  reference          text NOT NULL UNIQUE,              -- kurz, für Gäste lesbar, z. B. 'K7Q-4M2P'
  public_token       text NOT NULL UNIQUE,              -- 32 Byte zufällig, für Gast-Links (Ansehen/Stornieren)
  source             text NOT NULL CHECK (source IN ('direct','booking_com','expedia','airbnb','other_ota','admin')),
  status             text NOT NULL CHECK (status IN ('hold','confirmed','expired','cancelled','no_show')),
  checkin            date NOT NULL,
  checkout           date NOT NULL,
  adults             integer NOT NULL CHECK (adults >= 1),
  children           integer NOT NULL DEFAULT 0,
  guest_id           uuid REFERENCES guests(id),
  rooms_total_rappen integer NOT NULL DEFAULT 0,        -- Summe Zimmerpreise
  tourist_tax_rappen integer NOT NULL DEFAULT 0,
  total_rappen       integer NOT NULL DEFAULT 0,        -- was der Gast bezahlt
  platform_fee_rappen integer NOT NULL DEFAULT 0,       -- unsere Gebühr (nur source='direct')
  hold_expires_at    timestamptz,
  confirmed_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  channex_booking_id uuid UNIQUE,
  ota_reservation_code text,
  guest_notes        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (checkout > checkin)
);
CREATE INDEX ON bookings(hotel_id, checkin);
CREATE INDEX ON bookings(status, hold_expires_at);

CREATE TABLE booking_rooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  hotel_id      uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_type_id  uuid NOT NULL REFERENCES room_types(id),
  rate_plan_id  uuid REFERENCES rate_plans(id),         -- NULL erlaubt bei unbekanntem OTA-Mapping
  adults        integer NOT NULL,
  children      integer NOT NULL DEFAULT 0,
  nightly_prices jsonb NOT NULL,                         -- [{night:'2026-12-01', price_rappen: 18000}, ...] eingefroren bei Buchung
  amount_rappen integer NOT NULL
);
CREATE INDEX ON booking_rooms(booking_id);

CREATE TABLE payments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                  uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  booking_id                uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id  text UNIQUE,
  method                    text,                        -- 'card','twint','apple_pay','google_pay'
  amount_rappen             integer NOT NULL,
  application_fee_rappen    integer NOT NULL DEFAULT 0,
  refunded_rappen           integer NOT NULL DEFAULT 0,
  status                    text NOT NULL CHECK (status IN ('pending','succeeded','failed','refunded','partially_refunded')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- ---------- Integration und Infrastruktur ----------
-- Jede eingehende Nachricht (Stripe, Channex) genau einmal verarbeiten.
CREATE TABLE inbound_events (
  source        text NOT NULL CHECK (source IN ('stripe','channex')),
  event_id      text NOT NULL,
  type          text NOT NULL,
  payload       jsonb NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  error         text,
  PRIMARY KEY (source, event_id)
);

-- Ausgehende ARI-Änderungen an Channex (Outbox). Ein Eintrag = ein Datumsbereich, der neu gesendet werden muss.
CREATE TABLE channex_outbox (
  id            bigserial PRIMARY KEY,
  hotel_id      uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('availability','restrictions')),
  room_type_id  uuid REFERENCES room_types(id),     -- bei availability
  rate_plan_id  uuid REFERENCES rate_plans(id),     -- bei restrictions
  date_from     date NOT NULL,
  date_to       date NOT NULL,                      -- inklusiv
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  attempts      integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);
CREATE INDEX ON channex_outbox(status, next_attempt_at);
CREATE INDEX ON channex_outbox(hotel_id, kind, status);

CREATE TABLE email_outbox (
  id            bigserial PRIMARY KEY,
  hotel_id      uuid REFERENCES hotels(id) ON DELETE CASCADE,
  booking_id    uuid REFERENCES bookings(id) ON DELETE CASCADE,
  template      text NOT NULL,          -- 'booking_confirmed','booking_cancelled','pre_arrival','post_stay','hotel_new_booking','overbooking_alert','checkin_link'
  to_email      text NOT NULL,
  language      text NOT NULL DEFAULT 'de',
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  send_after    timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled')),
  attempts      integer NOT NULL DEFAULT 0,
  sent_at       timestamptz,
  UNIQUE (booking_id, template, to_email)
);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  hotel_id    uuid REFERENCES hotels(id) ON DELETE CASCADE,
  actor       text NOT NULL,            -- 'user:<id>', 'system', 'stripe', 'channex', 'guest'
  action      text NOT NULL,            -- z. B. 'rates.update', 'booking.cancel'
  entity      text,
  entity_id   text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log(hotel_id, created_at);

-- ---------- Kurtaxe pro Gemeinde ----------
-- Altersgrenzen: Alter < free_under_age → 0; Alter < reduced_under_age → reduced; sonst adult.
-- Alter am Anreisetag. Unbekanntes Alter eines Kindes → reduced (falls vorhanden), sonst adult.
CREATE TABLE tourist_tax_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canton                char(2) NOT NULL,
  municipality          text NOT NULL,                  -- amtlicher Gemeindename
  valid_from            date NOT NULL,
  category              text NOT NULL DEFAULT 'hotel' CHECK (category IN ('hotel','group')),
  adult_rappen          integer,                        -- NULL = Satz unbekannt → Hotel muss bestätigen, Buchung zeigt Hinweis
  reduced_rappen        integer,
  free_under_age        integer NOT NULL DEFAULT 0,
  reduced_under_age     integer,
  reporting_system      text,                           -- z. B. 'AVS', 'Heidiland Tourismus (monatlich)', 'Gemeinde'
  status                text NOT NULL CHECK (status IN ('verified','needs_confirmation','none')),
  notes                 text,
  source_url            text,
  checked_at            date NOT NULL,
  UNIQUE (canton, municipality, category, valid_from)
);

INSERT INTO tourist_tax_rules (canton, municipality, valid_from, category, adult_rappen, reduced_rappen, free_under_age, reduced_under_age, reporting_system, status, notes, source_url, checked_at) VALUES
 ('GL','Glarus','2024-11-01','hotel',440,220,6,16,'AVS (meldeschein.avs.de/glarus)','verified','Merkblatt V2 11/2024; inkl. ÖV (GlarnerlandPass); Abrechnung Hotels quartalsweise','https://visit.glarnerland.ch/files/glarnerland.ch/media/VISIT%20Glarnerland/GlarnerlandPass/20241119_VG_Gestaltung%20Merkblatt%20Ga%CC%88stetaxenreglement_A4_Glarus.pdf','2026-11-06'),
 ('GL','Glarus','2024-11-01','group',300,150,6,16,'AVS (meldeschein.avs.de/glarus)','verified','Gruppenunterkünfte, Clubhäuser, SAC-Hütten, Camping','https://visit.glarnerland.ch/files/glarnerland.ch/media/VISIT%20Glarnerland/GlarnerlandPass/20241119_VG_Gestaltung%20Merkblatt%20Ga%CC%88stetaxenreglement_A4_Glarus.pdf','2026-11-06'),
 ('GL','Glarus Nord','2025-01-01','hotel',440,220,5,16,'Gemeinde Glarus Nord','verified','Befreit: Kinder bis vollendetes 5. Altersjahr; halber Satz 6–15 (Alter 5 im Reglement unklar, hier reduziert); Hotels quartalsweise','https://www.glarus-nord.ch/public/upload/assets/57220/36.01_G%C3%A4stetaxen-Reglement%20der%20Gemeinde%20Glarus%20Nord.pdf?fp=1','2026-11-06'),
 ('GL','Glarus Süd','2022-07-01','hotel',320,160,6,17,'Gemeinde Glarus Süd','verified','Kinder 6–16 halber Satz; Tarifanhang Stand 2018; Hotels monatlich','https://www.glarus-sued.ch/public/upload/assets/53905/Reglement%20Kurtaxen%20inklusive%20Tarife.pdf?fp=1711356381579','2026-11-06'),
 ('GL','Glarus Süd','2022-07-01','group',190,95,6,17,'Gemeinde Glarus Süd','verified','Gruppenunterkünfte, Clubhäuser, SAC-Hütten, Camping','https://www.glarus-sued.ch/public/upload/assets/53905/Reglement%20Kurtaxen%20inklusive%20Tarife.pdf?fp=1711356381579','2026-11-06'),
 ('SG','St. Gallen','2025-01-01','hotel',450,NULL,16,NULL,'AVS (über St.Gallen-Bodensee Tourismus)','verified','Hotels inkl. Mobility Ticket; unter 16 befreit; valid_from = Annahme (Satz Stand Partnerportal 11/2026)','https://partner.st.gallen-bodensee.ch/de/dienstleistungen/digitales-meldewesen.html','2026-11-06'),
 ('SG','St. Gallen','2025-01-01','group',350,NULL,16,NULL,'AVS (über St.Gallen-Bodensee Tourismus)','verified','Hostels, Ferienwohnungen, Gruppen, Camping; valid_from = Annahme','https://partner.st.gallen-bodensee.ch/de/dienstleistungen/digitales-meldewesen.html','2026-11-06'),
 ('SG','Flums','2025-01-01','hotel',340,NULL,6,NULL,'Heidiland Tourismus (monatlich bis 5.)','verified','inkl. CHF 1.00 Infrastrukturbeitrag; frei bis 6 (hier: unter 6); valid_from = Annahme','https://partner.heidiland.com/dienstleistungen/fuer-unterkuenfte/kurtaxen.html','2026-11-06'),
 ('SG','Vilters-Wangs','2025-01-01','hotel',290,NULL,6,NULL,'Heidiland Tourismus (monatlich bis 5.)','verified','frei bis 6 (hier: unter 6); valid_from = Annahme','https://partner.heidiland.com/dienstleistungen/fuer-unterkuenfte/kurtaxen.html','2026-11-06'),
 ('SG','Wildhaus-Alt St. Johann','2026-01-01','hotel',NULL,NULL,0,NULL,'Toggenburg Tourismus (digitales Meldewesen)','needs_confirmation','Satz nicht gefunden; bei Gemeinde bzw. Toggenburg Tourismus erfragen',NULL,'2026-11-06'),
 ('AI','Schwende-Rüte','2020-01-01','hotel',250,NULL,0,NULL,'Kanton AI (Volkswirtschaftsdepartement)','verified','Kantonal einheitlich Fr. 2.50 je Übernachtung (TFV Art. 4); keine Kinderregel in der Verordnung; eine Drittquelle nennt 2.70 für 2026 → bestätigen','https://ai.clex.ch/app/de/texts_of_law/935.110','2026-11-06'),
 ('AR','Speicher','2023-01-01','hotel',100,NULL,0,NULL,'Gemeinde Speicher','needs_confirmation','Revision: Erhöhung von 0.50 auf 1.00 je Logiernacht; Inkrafttreten und Kinderregel bestätigen; zusätzlich kantonale Tourismusabgabe pro Zimmer (betrifft Hotel, nicht Gast)','https://www.nau.ch/ort/appenzell/das-revision-kurtaxenreglement-wurde-in-speicher-genehmigt-66227967','2026-11-06'),
 ('AR','Hundwil','1977-12-04','hotel',NULL,NULL,0,NULL,'Gemeinde Hundwil','needs_confirmation','Kurtaxenreglement von 1977 existiert, Satz nicht gefunden','https://www.hundwil.ch/','2026-11-06'),
 ('TG','Egnach','2026-01-01','hotel',0,NULL,0,NULL,NULL,'none','Thurgau erhebt heute keine Kurtaxe; kantonale Einführung geplant (Vernehmlassung bis 16.10.2026: Hotels CHF 2–5, Kinder bis 12 befreit)','https://www.radiocentral.ch/news/wirtschaft/der-kanton-thurgau-will-neu-kurtaxen-einfuehren-164627637','2026-11-06');

-- ---------- Modul "Gäste" (Phase 2) ----------
CREATE TABLE guest_registrations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id           uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  booking_id         uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  is_primary         boolean NOT NULL DEFAULT false,
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  sex                text CHECK (sex IN ('f','m','x')),
  birth_date         date,
  nationality        char(2),                 -- ISO 3166-1 alpha-2
  street             text,
  postal_code        text,
  city               text,
  country            char(2),
  id_document_type   text CHECK (id_document_type IN ('passport','id_card','residence_permit','other')),
  id_document_number text,
  vehicle_plate      text,
  arrival_date       date NOT NULL,
  departure_date     date NOT NULL,
  room_label         text,
  tourist_tax_liable boolean NOT NULL DEFAULT true,
  signature_png_url  text,                    -- nur wenn Kanton Unterschrift verlangt (z. B. GL)
  confirmed_by_guest_at timestamptz,
  verified_by_staff_at  timestamptz,          -- Personal hat Ausweis gesehen
  retention_until    date NOT NULL,           -- abgeleitet aus canton_rules
  exported_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON guest_registrations(hotel_id, arrival_date);
CREATE INDEX ON guest_registrations(retention_until);

CREATE TABLE canton_rules (
  canton              char(2) PRIMARY KEY,
  retention_years     integer,               -- NULL = unbekannt, dann 5 Jahre verwenden und Warnung zeigen
  signature_required  boolean NOT NULL DEFAULT false,
  online_reporting    text NOT NULL DEFAULT 'none' CHECK (online_reporting IN ('none','portal','easygov')),
  notes               text,
  source_url          text
);
INSERT INTO canton_rules (canton, retention_years, signature_required, online_reporting, notes, source_url) VALUES
 ('SG', 5, false, 'none', 'Hotelmeldeschein vollständig ausfüllen lassen; Gruppen: Teilnehmerliste genügt; Herausgabe an Polizei auf Verlangen (PolG Art. 52bis)', 'https://www.ratsinfo.sg.ch/media/documents/published/7c6d4267-aab7-402b-91f5-41baab50e691_PAdnI8i.pdf'),
 ('TG', NULL, false, 'none', 'Personalien und Herkunft erfassen und der Polizei zur Verfügung halten (Gastgewerbegesetz § 18)', 'https://www.rechtsbuch.tg.ch/app/de/texts_of_law/554.51/versions/2722'),
 ('GL', 3, true, 'none', 'Meldeschein nach amtlichem Ausweis ausfüllen und unterzeichnen lassen; auf Verlangen an Kantonspolizei (Gastgewerbegesetz Art. 21)', 'https://gesetze.gl.ch/app/de/texts_of_law/IX-B.22.1'),
 ('AR', 5, false, 'none', 'Meldescheine bei Ankunft; Form frei (Plattform/Excel); der Polizei zur Verfügung stellen (Gastgewerbegesetz Art. 12)', 'https://ar.ch/verwaltung/departement-bau-und-volkswirtschaft/amt-fuer-wirtschaft-und-arbeit/tourismus/tourismusabgabe/'),
 ('AI', NULL, false, 'none', 'Regel nicht verifiziert, Gastgewerbegesetz in Revision: bei Kantonspolizei AI nachfragen', NULL);
