-- KI-Einrichtung aus Website-Adresse oder PDF (SPEC 19.36): Entwurf zur Prüfung, nur Zähler und Entwurfsdaten, keine Quelltexte
CREATE TABLE setup_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('url', 'pdf')),
  source        text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'draft', 'adopted', 'discarded', 'failed')),
  draft         jsonb NOT NULL DEFAULT '{}',
  error         text,
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  adopted_at    timestamptz
);
CREATE INDEX setup_imports_hotel_idx ON setup_imports (hotel_id, created_at DESC);
CREATE INDEX setup_imports_created_idx ON setup_imports (created_at);
