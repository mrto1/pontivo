-- Rechnung und Kasse (SPEC 16.3)
CREATE TABLE invoice_counters (
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  year integer NOT NULL,
  last integer NOT NULL DEFAULT 0,
  PRIMARY KEY (hotel_id, year)
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  booking_id uuid REFERENCES bookings(id),
  kind text NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice', 'credit_note')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued')),
  number text,
  issued_on date,
  due_on date,
  recipient jsonb NOT NULL DEFAULT '{}',
  credit_of uuid REFERENCES invoices(id),
  total_rappen integer NOT NULL DEFAULT 0,
  vat_rappen integer NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz,
  UNIQUE (hotel_id, number)
);
CREATE INDEX invoices_hotel ON invoices (hotel_id, status, issued_on DESC);
CREATE INDEX invoices_booking ON invoices (booking_id);

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  position integer NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price_rappen integer NOT NULL,
  amount_rappen integer NOT NULL, -- Brutto, inkl. MWST
  vat_bps integer NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('stay', 'extra', 'tax', 'discount', 'other'))
);
CREATE INDEX invoice_lines_invoice ON invoice_lines (invoice_id, position);

-- Posten auf der Buchung (Minibar, Restaurant …), bis sie fakturiert sind
CREATE TABLE folio_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity <> 0),
  unit_price_rappen integer NOT NULL,
  vat_kind text NOT NULL DEFAULT 'standard' CHECK (vat_kind IN ('stay', 'standard', 'none')),
  invoice_id uuid REFERENCES invoices(id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX folio_items_booking ON folio_items (booking_id);

-- Zahlungen vor Ort (bar, Karte, TWINT, Bank). Negativ = Rückzahlung.
CREATE TABLE onsite_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  amount_rappen integer NOT NULL CHECK (amount_rappen <> 0),
  method text NOT NULL CHECK (method IN ('cash', 'card', 'twint', 'bank', 'other')),
  note text NOT NULL DEFAULT '',
  received_on date NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX onsite_payments_booking ON onsite_payments (booking_id);

-- Bisher als «vor Ort erhalten» markierte Restzahlungen erscheinen als Zahlung
INSERT INTO onsite_payments (hotel_id, booking_id, amount_rappen, method, note, received_on, actor)
SELECT hotel_id, id, balance_rappen, 'other', 'Restzahlung vor Ort erhalten (übernommen)', balance_onsite_at::date, 'migration'
  FROM bookings WHERE balance_onsite_at IS NOT NULL AND balance_rappen > 0;
