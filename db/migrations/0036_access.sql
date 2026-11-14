-- PMS Stufe C.5: Zutritt mit Nuki (Keypad-Codes je Buchung). SPEC 18.5
CREATE TABLE door_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  nuki_smartlock_id bigint NOT NULL,
  name text NOT NULL,
  -- leer = Eingangstür (alle Buchungen), sonst Zimmertür
  room_id uuid REFERENCES rooms(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, nuki_smartlock_id)
);

CREATE TABLE door_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  lock_id uuid NOT NULL REFERENCES door_locks(id),
  code_enc text NOT NULL,
  auth_name text NOT NULL,
  nuki_auth_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked','expired','error')),
  error text,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, lock_id)
);
CREATE INDEX door_codes_hotel_status ON door_codes (hotel_id, status);
