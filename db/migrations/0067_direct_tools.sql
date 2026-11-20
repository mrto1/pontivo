-- Direktbuchungs-Werkzeuge (SPEC 19.29): Firmencodes, Warteliste, Rabatt und Direktvorteile an der Buchung, Abbruch-Mail

-- Firmencode: Firma, Rabatt in Basispunkten, optional «auf Rechnung»
CREATE TABLE company_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code           text NOT NULL CHECK (code ~ '^[A-Z0-9-]{4,24}$'),
  discount_bps   integer NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 5000),
  pay_on_invoice boolean NOT NULL DEFAULT false,
  valid_from     date,
  valid_until    date,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, code)
);
CREATE INDEX company_codes_company ON company_codes (company_id);

-- Warteliste: Gast möchte benachrichtigt werden, wenn für seine Daten etwas frei wird
CREATE TABLE waitlist_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  email       text NOT NULL,
  name        text NOT NULL DEFAULT '',
  language    text NOT NULL DEFAULT 'de',
  checkin     date NOT NULL,
  checkout    date NOT NULL,
  adults      integer NOT NULL DEFAULT 2,
  children    integer NOT NULL DEFAULT 0,
  child_ages  integer[] NOT NULL DEFAULT '{}',
  token       text NOT NULL UNIQUE,
  status      text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified', 'cancelled', 'expired')),
  notified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, email, checkin, checkout)
);
CREATE INDEX waitlist_hotel_status ON waitlist_entries (hotel_id, status);

-- Buchung: angewandter Rabatt (Firmencode oder Lückenfüller), Direktvorteile zum Buchungszeitpunkt, Abbruch-Mail
ALTER TABLE bookings
  ADD COLUMN company_code_id  uuid REFERENCES company_codes(id) ON DELETE SET NULL,
  ADD COLUMN discount_rappen  integer NOT NULL DEFAULT 0,
  ADD COLUMN discount_kind    text CHECK (discount_kind IN ('company', 'gap')),
  ADD COLUMN direct_benefits  jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN recovery_sent_at timestamptz;
