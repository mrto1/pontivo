-- Restaurant und Kasse (SPEC 19.16). Bons, Bestellzeilen, Zahlungen und Tagesabschlüsse sind append-only (Art. 958f Abs. 4 OR, Art. 3 GeBüV).
ALTER TABLE folio_items ADD COLUMN vat_bps_override integer;

CREATE TABLE pos_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  category text NOT NULL DEFAULT '',
  name text NOT NULL,
  price_rappen integer NOT NULL CHECK (price_rappen >= 0),
  vat_dine_in_bps integer NOT NULL DEFAULT 810 CHECK (vat_dine_in_bps BETWEEN 0 AND 2500),
  vat_takeaway_bps integer NOT NULL DEFAULT 810 CHECK (vat_takeaway_bps BETWEEN 0 AND 2500),
  daily_special boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_items_hotel_idx ON pos_items (hotel_id);

CREATE TABLE pos_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (hotel_id, name)
);

-- Geräte mit eigenem lückenlosem Bon-Nummernkreis (auch offline)
CREATE TABLE pos_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]{1,6}$'),
  label text NOT NULL DEFAULT '',
  last_bon integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, code)
);

CREATE TABLE pos_orders (
  id uuid PRIMARY KEY,
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  table_id uuid REFERENCES pos_tables(id),
  device_id uuid REFERENCES pos_devices(id),
  label text NOT NULL DEFAULT '',
  opened_by text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  device_at timestamptz
);
CREATE INDEX pos_orders_hotel_idx ON pos_orders (hotel_id, opened_at DESC);

CREATE TABLE pos_order_lines (
  id uuid PRIMARY KEY,
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  order_id uuid NOT NULL REFERENCES pos_orders(id),
  item_id uuid REFERENCES pos_items(id),
  description text NOT NULL,
  quantity integer NOT NULL CHECK (quantity <> 0),
  unit_price_rappen integer NOT NULL,
  vat_bps integer NOT NULL CHECK (vat_bps BETWEEN 0 AND 2500),
  mode text NOT NULL DEFAULT 'dine_in' CHECK (mode IN ('dine_in','takeaway')),
  reverses_line_id uuid REFERENCES pos_order_lines(id),
  reason text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  device_at timestamptz
);
CREATE INDEX pos_order_lines_order_idx ON pos_order_lines (order_id);

CREATE TABLE pos_receipts (
  id uuid PRIMARY KEY,
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  order_id uuid NOT NULL REFERENCES pos_orders(id),
  device_id uuid NOT NULL REFERENCES pos_devices(id),
  bon_no integer NOT NULL,
  number text NOT NULL,
  seq bigint NOT NULL,
  kind text NOT NULL DEFAULT 'sale' CHECK (kind IN ('sale','reversal')),
  reverses_receipt_id uuid REFERENCES pos_receipts(id),
  items jsonb NOT NULL,
  total_rappen integer NOT NULL,
  vat jsonb NOT NULL,
  tip_rappen integer NOT NULL DEFAULT 0,
  business_day date NOT NULL,
  late boolean NOT NULL DEFAULT false,
  cashier text NOT NULL,
  paid_at timestamptz NOT NULL DEFAULT now(),
  device_at timestamptz,
  prev_hash text NOT NULL,
  hash text NOT NULL,
  UNIQUE (hotel_id, seq),
  UNIQUE (device_id, bon_no)
);
CREATE INDEX pos_receipts_day_idx ON pos_receipts (hotel_id, business_day);

CREATE TABLE pos_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  receipt_id uuid NOT NULL REFERENCES pos_receipts(id),
  method text NOT NULL CHECK (method IN ('cash','card','twint','room')),
  amount_rappen integer NOT NULL,
  booking_id uuid REFERENCES bookings(id),
  folio_item_ids uuid[] NOT NULL DEFAULT '{}'
);
CREATE INDEX pos_payments_receipt_idx ON pos_payments (receipt_id);

CREATE TABLE pos_day_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  day date NOT NULL,
  report jsonb NOT NULL,
  counted_cash_rappen integer NOT NULL,
  difference_rappen integer NOT NULL,
  note text NOT NULL DEFAULT '',
  closed_by text NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, day)
);

-- Append-only: Änderungen und Löschungen sind verboten, Korrekturen nur als Gegenbuchung
CREATE FUNCTION pos_block_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabelle % ist unveränderbar (nur Gegenbuchung)', TG_TABLE_NAME;
END $$;
CREATE TRIGGER pos_order_lines_immutable BEFORE UPDATE OR DELETE ON pos_order_lines FOR EACH ROW EXECUTE FUNCTION pos_block_mutation();
CREATE TRIGGER pos_receipts_immutable BEFORE UPDATE OR DELETE ON pos_receipts FOR EACH ROW EXECUTE FUNCTION pos_block_mutation();
CREATE TRIGGER pos_payments_immutable BEFORE UPDATE OR DELETE ON pos_payments FOR EACH ROW EXECUTE FUNCTION pos_block_mutation();
CREATE TRIGGER pos_day_closes_immutable BEFORE UPDATE OR DELETE ON pos_day_closes FOR EACH ROW EXECUTE FUNCTION pos_block_mutation();
