-- Newsletter an Gäste mit Einwilligung (SPEC 19.12)
CREATE TABLE newsletters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  subject text NOT NULL,
  body text NOT NULL,
  segment jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent')),
  recipients integer NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX newsletters_hotel_idx ON newsletters (hotel_id, created_at DESC);
