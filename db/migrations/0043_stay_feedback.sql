-- Bewertungen einholen (SPEC 19.2): interne Zufriedenheitsfrage nach dem Aufenthalt
CREATE TABLE stay_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '',
  public_link_shown boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id)
);
CREATE INDEX stay_feedback_hotel_idx ON stay_feedback (hotel_id, created_at DESC);
