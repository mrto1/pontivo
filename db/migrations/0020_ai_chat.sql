-- KI-Chat (SPEC 14b): Modul ai_chat, Tarife, Nutzungszähler (ohne Gesprächstexte), Abrechnungsspalten.

ALTER TABLE hotel_modules DROP CONSTRAINT IF EXISTS hotel_modules_module_check;
ALTER TABLE hotel_modules ADD CONSTRAINT hotel_modules_module_check
  CHECK (module IN ('guests','invoicing','housekeeping','reports','groups','ai_chat'));

-- Tarife als Daten (Preise ohne MWST, in Rappen). Zusatzpaket: pack_size = 0 → keine Zusatzpakete.
CREATE TABLE ai_plans (
  code                   text PRIMARY KEY,
  name                   text NOT NULL,
  price_rappen           integer NOT NULL CHECK (price_rappen >= 0),
  included_conversations integer NOT NULL CHECK (included_conversations > 0),
  pack_size              integer NOT NULL DEFAULT 0 CHECK (pack_size >= 0),
  pack_price_rappen      integer NOT NULL DEFAULT 0 CHECK (pack_price_rappen >= 0),
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ai_plans (code, name, price_rappen, included_conversations, pack_size, pack_price_rappen, active) VALUES
  ('basic', 'Basis', 1900, 250, 100, 500, true),
  ('mini',  'Mini',   490,  50,   0,   0, false);

-- Eine Zeile pro Gespräch (Sitzung). Nur Zähler, keine Texte.
CREATE TABLE ai_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  month         text NOT NULL,
  surface       text NOT NULL DEFAULT 'site' CHECK (surface IN ('site','booking')),
  messages      integer NOT NULL DEFAULT 0,
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  started_at    timestamptz NOT NULL DEFAULT now(),
  last_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_hotel_month ON ai_usage (hotel_id, month);

ALTER TABLE platform_charges ADD COLUMN ai_module_rappen integer NOT NULL DEFAULT 0;
ALTER TABLE platform_charges ADD COLUMN ai_packs_rappen  integer NOT NULL DEFAULT 0;
