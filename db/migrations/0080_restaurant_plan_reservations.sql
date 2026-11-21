-- Restaurant, Etappe C (SPEC 19.49): Tischplan, Tischreservierungen (intern und online)
ALTER TABLE pos_tables
  ADD COLUMN seats integer NOT NULL DEFAULT 2 CHECK (seats BETWEEN 1 AND 50),
  ADD COLUMN plan_x integer CHECK (plan_x BETWEEN 0 AND 1000),
  ADD COLUMN plan_y integer CHECK (plan_y BETWEEN 0 AND 1000),
  ADD COLUMN shape text NOT NULL DEFAULT 'square' CHECK (shape IN ('square','round'));

CREATE TABLE restaurant_settings (
  hotel_id uuid PRIMARY KEY REFERENCES hotels(id),
  online_enabled boolean NOT NULL DEFAULT false,
  windows jsonb NOT NULL DEFAULT '[{"from":"11:30","to":"13:30"},{"from":"18:00","to":"21:00"}]',
  duration_min integer NOT NULL DEFAULT 90 CHECK (duration_min BETWEEN 30 AND 480),
  max_party integer NOT NULL DEFAULT 8 CHECK (max_party BETWEEN 1 AND 50),
  capacity integer NOT NULL DEFAULT 40 CHECK (capacity BETWEEN 1 AND 1000),
  lead_hours integer NOT NULL DEFAULT 2 CHECK (lead_hours BETWEEN 0 AND 168),
  horizon_days integer NOT NULL DEFAULT 60 CHECK (horizon_days BETWEEN 1 AND 365),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pos_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  day date NOT NULL,
  time text NOT NULL CHECK (time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  party integer NOT NULL CHECK (party BETWEEN 1 AND 50),
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  table_id uuid REFERENCES pos_tables(id),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','seated','cancelled','noshow')),
  source text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin','online')),
  language text NOT NULL DEFAULT 'de',
  public_token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_reservations_day_idx ON pos_reservations (hotel_id, day);
