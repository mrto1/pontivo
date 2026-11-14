-- PMS Stufe C.4: Stripe Terminal (Kartenzahlung am Empfang, servergesteuert). SPEC 18.4
CREATE TABLE terminal_readers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  stripe_reader_id text NOT NULL UNIQUE,
  stripe_location_id text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX terminal_readers_hotel ON terminal_readers (hotel_id);

CREATE TABLE terminal_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  reader_id uuid NOT NULL REFERENCES terminal_readers(id),
  payment_intent_id text UNIQUE,
  amount_rappen integer NOT NULL CHECK (amount_rappen > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','canceled')),
  failure_code text,
  onsite_payment_id uuid,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX terminal_payments_booking ON terminal_payments (hotel_id, booking_id);
