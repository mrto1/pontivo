-- SPEC 20.4/20.5 (R3/R4): Online-Bestellung mit Abholung und Lieferung, Bestellbildschirm, SMS, Fahrer
ALTER TABLE pos_items
  ADD COLUMN online boolean NOT NULL DEFAULT true,
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN photo_url text,
  ADD COLUMN allergens text[] NOT NULL DEFAULT '{}';

CREATE TABLE online_order_settings (
  hotel_id uuid PRIMARY KEY REFERENCES hotels(id),
  enabled boolean NOT NULL DEFAULT false,
  pickup boolean NOT NULL DEFAULT true,
  delivery boolean NOT NULL DEFAULT false,
  slot_minutes integer NOT NULL DEFAULT 15 CHECK (slot_minutes BETWEEN 5 AND 60),
  max_per_slot integer NOT NULL DEFAULT 5 CHECK (max_per_slot BETWEEN 1 AND 100),
  delivery_per_slot integer NOT NULL DEFAULT 3 CHECK (delivery_per_slot BETWEEN 1 AND 100),
  lead_min integer NOT NULL DEFAULT 20 CHECK (lead_min BETWEEN 0 AND 240),
  cutoff_min integer NOT NULL DEFAULT 15 CHECK (cutoff_min BETWEEN 0 AND 240),
  cash_pickup boolean NOT NULL DEFAULT false,
  cash_delivery boolean NOT NULL DEFAULT false,
  cash_max_rappen integer CHECK (cash_max_rappen IS NULL OR cash_max_rappen > 0),
  guest_sms boolean NOT NULL DEFAULT false,
  paused_until timestamptz,
  auto_paused boolean NOT NULL DEFAULT false,
  test_passed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  name text NOT NULL,
  postal_codes text[] NOT NULL,
  min_order_rappen integer NOT NULL DEFAULT 0 CHECK (min_order_rappen >= 0),
  fee_rappen integer NOT NULL DEFAULT 0 CHECK (fee_rappen >= 0),
  free_from_rappen integer CHECK (free_from_rappen IS NULL OR free_from_rappen > 0),
  extra_minutes integer NOT NULL DEFAULT 15 CHECK (extra_minutes BETWEEN 0 AND 180),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_zones_hotel_idx ON delivery_zones (hotel_id);

CREATE TABLE online_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  day date NOT NULL,
  number text NOT NULL,
  public_token text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('pickup','delivery')),
  status text NOT NULL CHECK (status IN ('pending_payment','new','accepted','ready','out','completed','rejected','expired','cancelled','not_accepted')),
  payment text NOT NULL CHECK (payment IN ('card','cash')),
  name text NOT NULL,
  phone text NOT NULL,
  email text NOT NULL DEFAULT '',
  language text NOT NULL DEFAULT 'de',
  street text NOT NULL DEFAULT '', house_no text NOT NULL DEFAULT '', postal_code text NOT NULL DEFAULT '', city text NOT NULL DEFAULT '',
  floor text NOT NULL DEFAULT '', bell text NOT NULL DEFAULT '', address_hint text NOT NULL DEFAULT '',
  zone_id uuid REFERENCES delivery_zones(id),
  items jsonb NOT NULL,
  subtotal_rappen integer NOT NULL CHECK (subtotal_rappen >= 0),
  delivery_fee_rappen integer NOT NULL DEFAULT 0 CHECK (delivery_fee_rappen >= 0),
  total_rappen integer NOT NULL CHECK (total_rappen >= 0),
  fee_rappen integer NOT NULL DEFAULT 0 CHECK (fee_rappen >= 0),
  requested_at timestamptz NOT NULL,
  promised_at timestamptz,
  note text NOT NULL DEFAULT '',
  reject_reason text NOT NULL DEFAULT '',
  is_test boolean NOT NULL DEFAULT false,
  stripe_session_id text,
  stripe_payment_intent_id text,
  refunded_at timestamptz,
  pos_order_id uuid,
  receipt_id uuid,
  driver text NOT NULL DEFAULT '',
  alarmed_at timestamptz,
  accepted_at timestamptz, ready_at timestamptz, out_at timestamptz, completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, day, number)
);
CREATE INDEX online_orders_hotel_status_idx ON online_orders (hotel_id, status);

CREATE TABLE delivery_flags (
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  address_key text NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, address_key)
);

CREATE TABLE order_screens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  device_key text NOT NULL,
  label text NOT NULL DEFAULT '',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  battery integer,
  charging boolean,
  sound_ok_at timestamptz,
  UNIQUE (hotel_id, device_key)
);

CREATE TABLE sms_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid REFERENCES hotels(id),
  ref text UNIQUE,
  to_phone text NOT NULL,
  text text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('alarm','guest')),
  billable boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX sms_outbox_status_idx ON sms_outbox (status);

-- Plattformrechnung: nicht einbehaltene Gebühren (Barzahlung) und weiterverrechnete Gast-SMS
ALTER TABLE platform_charges ADD COLUMN uncollected_fees_rappen integer NOT NULL DEFAULT 0, ADD COLUMN sms_rappen integer NOT NULL DEFAULT 0;

-- Rolle Fahrer
ALTER TABLE hotel_members DROP CONSTRAINT IF EXISTS hotel_members_role_check;
ALTER TABLE hotel_members ADD CONSTRAINT hotel_members_role_check
  CHECK (role IN ('owner', 'manager', 'staff', 'reception', 'housekeeping', 'accounting', 'service', 'driver') OR role ~ '^custom:[0-9a-f-]{36}$');
