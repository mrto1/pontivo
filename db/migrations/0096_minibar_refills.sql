-- Minibar nachfüllen (SPEC 19.51): offene Nachfüllposten je Zimmer, entstehen bei der Zählung
CREATE TABLE minibar_refills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  room_id uuid NOT NULL REFERENCES rooms(id),
  good_id uuid NOT NULL REFERENCES goods(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz
);
CREATE INDEX minibar_refills_open_idx ON minibar_refills (hotel_id) WHERE done_at IS NULL;
