-- KI-Preisempfehlung (Modul ai_pricing): Herkunft der Vorschläge und Protokoll der Läufe (nur Zähler, keine Texte)
ALTER TABLE pricing_proposals ADD COLUMN source text NOT NULL DEFAULT 'rules' CHECK (source IN ('rules','ai'));

CREATE TABLE ai_pricing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  day date NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','error')),
  model text NOT NULL,
  nights int NOT NULL DEFAULT 0,
  proposals int NOT NULL DEFAULT 0,
  rejected int NOT NULL DEFAULT 0,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_pricing_runs_hotel_day ON ai_pricing_runs (hotel_id, day);
