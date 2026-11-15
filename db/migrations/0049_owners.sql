-- Eigentümerabrechnung (SPEC 19.10)
CREATE TABLE owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  name text NOT NULL,
  email text NOT NULL DEFAULT '',
  commission_bps integer NOT NULL DEFAULT 0 CHECK (commission_bps BETWEEN 0 AND 10000),
  room_type_ids uuid[] NOT NULL DEFAULT '{}',
  note text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX owners_hotel_idx ON owners (hotel_id);
CREATE TABLE owner_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  owner_id uuid NOT NULL REFERENCES owners(id),
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  description text NOT NULL,
  amount_rappen integer NOT NULL CHECK (amount_rappen > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX owner_costs_idx ON owner_costs (hotel_id, owner_id, month);
CREATE TABLE owner_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  owner_id uuid NOT NULL REFERENCES owners(id),
  month text NOT NULL,
  revenue_rappen integer NOT NULL,
  commission_rappen integer NOT NULL,
  costs_rappen integer NOT NULL,
  net_rappen integer NOT NULL,
  sent_to text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, month)
);
