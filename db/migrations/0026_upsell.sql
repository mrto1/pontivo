-- Upselling-Modul (SPEC 14d): Zusatzangebote, die der Gast nach der Buchung per Link kaufen kann
CREATE TABLE upsell_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name jsonb NOT NULL DEFAULT '{}',
  description jsonb NOT NULL DEFAULT '{}',
  price_rappen integer NOT NULL CHECK (price_rappen > 0),
  unit text NOT NULL CHECK (unit IN ('per_booking', 'per_night', 'per_person', 'per_person_night')),
  max_quantity integer NOT NULL DEFAULT 1 CHECK (max_quantity BETWEEN 1 AND 20),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX upsell_items_hotel ON upsell_items (hotel_id, active, sort_order);

CREATE TABLE upsell_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  lines jsonb NOT NULL, -- Momentaufnahme: [{name, quantity, amountRappen}]
  amount_rappen integer NOT NULL CHECK (amount_rappen > 0),
  fee_rappen integer NOT NULL CHECK (fee_rappen >= 0), -- Provision (Stripe application fee)
  fee_bps integer NOT NULL,
  source text NOT NULL DEFAULT 'email', -- Herkunft: email, chat
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  stripe_session_id text,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX upsell_orders_hotel ON upsell_orders (hotel_id, status, paid_at);
CREATE INDEX upsell_orders_booking ON upsell_orders (booking_id);

ALTER TABLE hotel_modules DROP CONSTRAINT IF EXISTS hotel_modules_module_check;
ALTER TABLE hotel_modules ADD CONSTRAINT hotel_modules_module_check
  CHECK (module IN ('guests','invoicing','housekeeping','reports','groups','ai_chat','upsell'));
