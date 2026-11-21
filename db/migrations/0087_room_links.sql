-- SPEC 20.10 (R6): Verpachtetes Restaurant bucht über den Schlüssel des Hotels aufs Zimmer
CREATE TABLE room_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  label        text NOT NULL DEFAULT '',
  key_enc      text NOT NULL,
  key_prefix   text NOT NULL,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE UNIQUE INDEX room_links_active_idx ON room_links (hotel_id) WHERE revoked_at IS NULL;

ALTER TABLE pos_payments ADD COLUMN remote_link_id uuid, ADD COLUMN remote_reference text;
