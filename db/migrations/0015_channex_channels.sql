-- Kanalverbindungen (Booking.com, später Airbnb) über die Channex Channel API, direkt im Pontivo-Admin.
ALTER TABLE hotels ADD COLUMN channex_group_id uuid;

CREATE TABLE channex_channels (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id           uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  channel            text NOT NULL CHECK (channel IN ('BookingCom')),
  external_id        text NOT NULL,                 -- Booking.com Hotel-ID
  channex_channel_id uuid UNIQUE,                   -- NULL, solange nur geprüft (noch nicht angelegt)
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','inactive','active')),
  details            jsonb NOT NULL DEFAULT '{}',   -- mapping_details + Währung der Gegenseite
  selection          jsonb NOT NULL DEFAULT '{}',   -- "<room>:<rate>" → rate_plans.id (Pontivo)
  mappings           jsonb NOT NULL DEFAULT '[]',   -- zuletzt an Channex gesendete rate_plans
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, channel)
);
