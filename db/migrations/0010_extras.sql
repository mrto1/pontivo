-- Zusatzleistungen pro Buchung (Hund, Parkplatz, Endreinigung, Frühstück dazu …)
CREATE TABLE extras (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name           jsonb NOT NULL DEFAULT '{}'::jsonb,       -- {de, en, fr, it, nl}
  description    jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_rappen   integer NOT NULL CHECK (price_rappen BETWEEN 0 AND 10000000),
  unit           text NOT NULL CHECK (unit IN ('per_booking', 'per_night', 'per_person', 'per_person_night')),
  max_quantity   integer NOT NULL DEFAULT 1 CHECK (max_quantity BETWEEN 1 AND 20),  -- bei pro Person: Anzahl Personen
  mandatory      boolean NOT NULL DEFAULT false,           -- z. B. Endreinigung: immer im Preis enthalten
  active         boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  room_type_ids  uuid[] NOT NULL DEFAULT '{}',              -- leer = alle Zimmertypen
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON extras(hotel_id);

-- Gebuchte Zusatzleistungen: Name und Preis eingefroren zum Buchungszeitpunkt
CREATE TABLE booking_extras (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  hotel_id           uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  extra_id           uuid REFERENCES extras(id) ON DELETE SET NULL,
  name               jsonb NOT NULL,
  unit               text NOT NULL,
  unit_price_rappen  integer NOT NULL CHECK (unit_price_rappen >= 0),
  quantity           integer NOT NULL CHECK (quantity >= 1),
  amount_rappen      integer NOT NULL CHECK (amount_rappen >= 0),
  position           integer NOT NULL DEFAULT 0                   -- Reihenfolge wie im Hotel-Katalog
);
CREATE INDEX ON booking_extras(booking_id);

ALTER TABLE bookings ADD COLUMN extras_rappen integer NOT NULL DEFAULT 0 CHECK (extras_rappen >= 0);
