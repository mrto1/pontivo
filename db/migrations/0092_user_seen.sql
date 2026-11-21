-- SPEC 20.1: Zahlen (Badges) für Ungesehenes, je Person: wann hat diese Person die jeweilige Liste zuletzt geöffnet
CREATE TABLE user_seen (
  user_id  uuid NOT NULL REFERENCES users(id),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  kind     text NOT NULL CHECK (kind IN ('inbox','bookings','reservations','orders')),
  seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, hotel_id, kind)
);
