-- iCal-Abgleich (SPEC 7b): Export-Feed pro Zimmertyp (geheimer Token), Import externer Kalender
ALTER TABLE room_types
  ADD COLUMN ical_token text NOT NULL UNIQUE
  DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

-- von importierten Kalendern belegte Zimmer je Nacht (getrennt von manuell gesperrten)
ALTER TABLE inventory_days ADD COLUMN external_blocked integer NOT NULL DEFAULT 0 CHECK (external_blocked >= 0);

CREATE TABLE ical_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  room_type_id uuid NOT NULL REFERENCES room_types(id),
  name text NOT NULL,
  url text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  last_conflicts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ical_feeds_room ON ical_feeds (room_type_id);

-- Nächte, die ein Import-Kalender belegt (Quelle für external_blocked)
CREATE TABLE ical_feed_nights (
  feed_id uuid NOT NULL REFERENCES ical_feeds(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL,
  room_type_id uuid NOT NULL,
  night date NOT NULL,
  PRIMARY KEY (feed_id, night)
);
CREATE INDEX ical_feed_nights_room ON ical_feed_nights (room_type_id, night);
