-- Restaurant, Etappe C2 (SPEC 19.49): Anzahlung als Garantie, Warteliste, Erinnerung, automatische Tischzuteilung
ALTER TABLE restaurant_settings
  ADD COLUMN deposit_per_person_rappen integer NOT NULL DEFAULT 0 CHECK (deposit_per_person_rappen BETWEEN 0 AND 100000),
  ADD COLUMN deposit_from_party integer NOT NULL DEFAULT 1 CHECK (deposit_from_party BETWEEN 1 AND 50),
  ADD COLUMN cancel_hours integer NOT NULL DEFAULT 24 CHECK (cancel_hours BETWEEN 0 AND 168),
  ADD COLUMN reminder_hours integer NOT NULL DEFAULT 24 CHECK (reminder_hours BETWEEN 0 AND 72),
  ADD COLUMN auto_assign boolean NOT NULL DEFAULT true;

ALTER TABLE pos_reservations DROP CONSTRAINT IF EXISTS pos_reservations_status_check;
ALTER TABLE pos_reservations ADD CONSTRAINT pos_reservations_status_check CHECK (status IN ('pending','confirmed','seated','cancelled','noshow'));
ALTER TABLE pos_reservations
  ADD COLUMN deposit_rappen integer NOT NULL DEFAULT 0 CHECK (deposit_rappen >= 0),
  ADD COLUMN deposit_status text NOT NULL DEFAULT 'none' CHECK (deposit_status IN ('none','pending','paid','refunded')),
  ADD COLUMN stripe_session_id text,
  ADD COLUMN stripe_payment_intent_id text,
  ADD COLUMN reminder_sent_at timestamptz;

CREATE TABLE pos_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  day date NOT NULL,
  party integer NOT NULL CHECK (party BETWEEN 1 AND 50),
  name text NOT NULL,
  email text NOT NULL,
  language text NOT NULL DEFAULT 'de',
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_waitlist_day_idx ON pos_waitlist (hotel_id, day);
