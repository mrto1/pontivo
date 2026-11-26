-- Restaurant: Tischplan mit Räumen, Orientierungselementen und rechteckigen Tischen (SPEC 19.53)
CREATE TABLE pos_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_areas_hotel_idx ON pos_areas (hotel_id, sort_order);

CREATE TABLE pos_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  area_id uuid NOT NULL REFERENCES pos_areas(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('wc','bar','coat','entrance','kitchen','stairs','wall','plant','text')),
  label text NOT NULL DEFAULT '',
  plan_x integer NOT NULL CHECK (plan_x BETWEEN 0 AND 1000),
  plan_y integer NOT NULL CHECK (plan_y BETWEEN 0 AND 1000),
  w integer NOT NULL DEFAULT 80 CHECK (w BETWEEN 10 AND 1000),
  h integer NOT NULL DEFAULT 60 CHECK (h BETWEEN 10 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_plan_items_area_idx ON pos_plan_items (hotel_id, area_id);

ALTER TABLE pos_tables ADD COLUMN area_id uuid REFERENCES pos_areas(id) ON DELETE SET NULL;
ALTER TABLE pos_tables DROP CONSTRAINT IF EXISTS pos_tables_shape_check;
ALTER TABLE pos_tables ADD CONSTRAINT pos_tables_shape_check CHECK (shape IN ('square','round','rect'));

-- Bestand: ein Raum "Innenbereich" pro Hotel mit Tischen
INSERT INTO pos_areas (hotel_id, name, sort_order)
SELECT DISTINCT hotel_id, 'Innenbereich', 0 FROM pos_tables;
UPDATE pos_tables t SET area_id = a.id FROM pos_areas a WHERE a.hotel_id = t.hotel_id;
