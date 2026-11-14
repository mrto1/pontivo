-- Zimmernummern und Zimmerplan (SPEC 16.2). Optional: booking_rooms.room_id leer = nur Zimmertyp, wie bisher.
CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  room_type_id uuid NOT NULL REFERENCES room_types(id),
  number text NOT NULL CHECK (length(number) BETWEEN 1 AND 20),
  floor text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, number)
);
CREATE INDEX rooms_type ON rooms (hotel_id, room_type_id, sort_order);

ALTER TABLE booking_rooms ADD COLUMN room_id uuid REFERENCES rooms(id);
CREATE INDEX booking_rooms_room ON booking_rooms (room_id) WHERE room_id IS NOT NULL;
