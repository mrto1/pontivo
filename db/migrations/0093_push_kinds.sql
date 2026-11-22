-- SPEC 20.1: Mitteilungen nach Art und Person. Jede Mitteilung hat eine Art (wie die Zahlen im Menü), jede Person kann Arten abstellen.
ALTER TABLE push_outbox ADD COLUMN kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('inbox','bookings','reservations','orders','other'));

CREATE TABLE push_prefs (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  kind     text NOT NULL CHECK (kind IN ('inbox','bookings','reservations','orders','other')),
  enabled  boolean NOT NULL,
  PRIMARY KEY (user_id, hotel_id, kind)
);
