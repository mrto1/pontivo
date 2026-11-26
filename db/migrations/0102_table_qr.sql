-- Tisch-QR: Bezahlen am Tisch mit Trinkgeld, Bewertung (SPEC 19.55)
ALTER TABLE pos_tables ADD COLUMN qr_token text UNIQUE;
UPDATE pos_tables SET qr_token = replace(gen_random_uuid()::text, '-', '') WHERE qr_token IS NULL;

ALTER TABLE restaurant_settings ADD COLUMN review_url text NOT NULL DEFAULT '';

CREATE TABLE table_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  table_id uuid NOT NULL REFERENCES pos_tables(id),
  order_id uuid NOT NULL REFERENCES pos_orders(id),
  public_token text NOT NULL UNIQUE,
  selection jsonb NOT NULL,
  items_rappen integer NOT NULL CHECK (items_rappen > 0),
  tip_rappen integer NOT NULL DEFAULT 0 CHECK (tip_rappen >= 0),
  waiter_id uuid REFERENCES pos_waiters(id) ON DELETE SET NULL,
  language text NOT NULL DEFAULT 'de',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled')),
  stripe_session_id text,
  stripe_payment_intent_id text,
  receipt_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX table_payments_hotel_idx ON table_payments (hotel_id, created_at);

CREATE TABLE table_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  table_payment_id uuid NOT NULL UNIQUE REFERENCES table_payments(id),
  stars integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
