-- Angebote vor Ort: buchbare Ressourcen wie Wellness, Sauna, Seminarraum, Tennis (SPEC 19.11)
CREATE TABLE resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('wellness','seminar','sport','other')),
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 500),
  slot_minutes integer NOT NULL DEFAULT 60 CHECK (slot_minutes BETWEEN 15 AND 480),
  open_from integer NOT NULL DEFAULT 480 CHECK (open_from BETWEEN 0 AND 1439),
  open_to integer NOT NULL DEFAULT 1200 CHECK (open_to BETWEEN 1 AND 1440),
  price_rappen integer NOT NULL DEFAULT 0 CHECK (price_rappen >= 0),
  price_per_person boolean NOT NULL DEFAULT false,
  vat_kind text NOT NULL DEFAULT 'standard' CHECK (vat_kind IN ('stay','standard','none')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (open_to > open_from)
);
CREATE INDEX resources_hotel_idx ON resources (hotel_id);
CREATE TABLE resource_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  resource_id uuid NOT NULL REFERENCES resources(id),
  booking_id uuid REFERENCES bookings(id),
  folio_item_id uuid,
  guest_name text NOT NULL,
  day date NOT NULL,
  start_min integer NOT NULL,
  end_min integer NOT NULL,
  persons integer NOT NULL CHECK (persons >= 1),
  price_rappen integer NOT NULL CHECK (price_rappen >= 0),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  note text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_min > start_min)
);
CREATE INDEX resource_bookings_idx ON resource_bookings (hotel_id, resource_id, day);
