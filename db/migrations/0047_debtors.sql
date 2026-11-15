-- Debitoren (SPEC 19.7): Firmenkunden, Rechnung auf Rechnung, Mahnwesen, Zahlungseingang aus Bankdatei
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  name text NOT NULL,
  street text NOT NULL DEFAULT '',
  zip text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'CH',
  vat_id text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  payment_days integer CHECK (payment_days BETWEEN 0 AND 365),
  note text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX companies_hotel_idx ON companies (hotel_id, name);
ALTER TABLE bookings ADD COLUMN company_id uuid REFERENCES companies(id);
ALTER TABLE invoices ADD COLUMN company_id uuid REFERENCES companies(id);
CREATE INDEX invoices_company_idx ON invoices (company_id) WHERE company_id IS NOT NULL;

CREATE TABLE invoice_dunnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  sent_on date NOT NULL,
  sent_to text NOT NULL,
  sent_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, level)
);

-- Bankdatei-Einträge (camt.054): jeder Eintrag wird nur einmal verbucht
CREATE TABLE bank_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  dedupe_key text NOT NULL,
  booked_on date NOT NULL,
  amount_rappen integer NOT NULL,
  reference text NOT NULL DEFAULT '',
  invoice_id uuid REFERENCES invoices(id),
  status text NOT NULL CHECK (status IN ('matched','unmatched','ignored')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, dedupe_key)
);
