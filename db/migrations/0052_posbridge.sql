-- PosBridge: Posten aus fremden Kassen aufs Zimmer buchen (SPEC 19.15)
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  label text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX api_keys_hotel_idx ON api_keys (hotel_id);
ALTER TABLE folio_items ADD COLUMN external_id text, ADD COLUMN source text;
CREATE UNIQUE INDEX folio_items_external_idx ON folio_items (hotel_id, external_id) WHERE external_id IS NOT NULL;
