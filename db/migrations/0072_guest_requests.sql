-- Gästeportal (SPEC 19.41): Wünsche der Gäste zu einer Buchung, sichtbar mit Status für Gast und Rezeption
CREATE TABLE guest_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  item_id     text NOT NULL DEFAULT '',
  label       text NOT NULL,
  message     text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  done_at     timestamptz,
  done_by     text
);
CREATE INDEX guest_requests_hotel_idx ON guest_requests (hotel_id, status, created_at DESC);
CREATE INDEX guest_requests_booking_idx ON guest_requests (booking_id, created_at);
