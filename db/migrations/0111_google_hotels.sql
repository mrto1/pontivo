-- Google Hotelpreise als eigener Connectivity-Partner (SPEC 19.70): zuletzt gesendete Stände je Betrieb und Baustein,
-- damit nur Geändertes an Google geht. `hash` = Stand der letzten erfolgreichen Sendung.
CREATE TABLE google_ari_state (
  hotel_id    uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('property', 'taxes', 'inventory', 'rate', 'availability')),
  key         text NOT NULL,
  hash        text,
  sent_at     timestamptz,
  failed_at   timestamptz,
  last_error  text,
  PRIMARY KEY (hotel_id, kind, key)
);
