-- Regelbasierte Preisempfehlung (SPEC 19.3)
CREATE TABLE pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  rate_plan_id uuid NOT NULL REFERENCES rate_plans(id),
  base_rappen integer NOT NULL CHECK (base_rappen > 0),
  min_rappen integer NOT NULL CHECK (min_rappen > 0),
  max_rappen integer NOT NULL CHECK (max_rappen >= min_rappen),
  occupancy_steps jsonb NOT NULL DEFAULT '[]',
  last_minute jsonb,
  weekday_bps jsonb NOT NULL DEFAULT '[0,0,0,0,0,0,0]',
  auto_apply boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rate_plan_id)
);
CREATE TABLE pricing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  name text NOT NULL,
  from_day date NOT NULL,
  to_day date NOT NULL CHECK (to_day >= from_day),
  adjust_bps integer NOT NULL
);
CREATE INDEX pricing_events_hotel_idx ON pricing_events (hotel_id, from_day);
CREATE TABLE pricing_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  rate_plan_id uuid NOT NULL REFERENCES rate_plans(id),
  night date NOT NULL,
  current_rappen integer NOT NULL,
  proposed_rappen integer NOT NULL CHECK (proposed_rappen > 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','applied','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by text
);
CREATE INDEX pricing_proposals_idx ON pricing_proposals (hotel_id, status, night);
