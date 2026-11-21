-- Restaurant, Etappe A (SPEC 19.49): Optionsgruppen, Optionen, Zuordnung zu Artikeln; Optionen und Sonderwunsch auf Bestellzeilen
CREATE TABLE pos_option_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  name text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  max_choices integer NOT NULL DEFAULT 1 CHECK (max_choices BETWEEN 1 AND 20),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, name)
);
CREATE TABLE pos_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  group_id uuid NOT NULL REFERENCES pos_option_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_rappen integer NOT NULL DEFAULT 0 CHECK (price_rappen BETWEEN 0 AND 1000000),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (group_id, name)
);
CREATE INDEX pos_options_group_idx ON pos_options (group_id);
CREATE TABLE pos_item_groups (
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  item_id uuid NOT NULL REFERENCES pos_items(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES pos_option_groups(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, group_id)
);
ALTER TABLE pos_order_lines ADD COLUMN options jsonb, ADD COLUMN note text NOT NULL DEFAULT '';
