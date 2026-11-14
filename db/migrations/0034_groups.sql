-- PMS Stufe C.1: Gruppen mit Zimmerblock, Freigabefrist, Rooming-Liste (SPEC 18.1)
CREATE TABLE groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  name text NOT NULL,
  company text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  street text NOT NULL DEFAULT '',
  zip text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  arrival date NOT NULL,
  departure date NOT NULL,
  release_on date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'cancelled')),
  note text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (departure > arrival)
);
CREATE INDEX groups_hotel ON groups (hotel_id, arrival);

-- reservierte, noch nicht an Teilnehmer vergebene Zimmer pro Nacht (sind in inventory_days.booked mitgezählt)
CREATE TABLE group_block_days (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  room_type_id uuid NOT NULL REFERENCES room_types(id),
  night date NOT NULL,
  rooms integer NOT NULL CHECK (rooms >= 0),
  PRIMARY KEY (group_id, room_type_id, night)
);

ALTER TABLE bookings ADD COLUMN group_id uuid REFERENCES groups(id);
CREATE INDEX bookings_group ON bookings (group_id) WHERE group_id IS NOT NULL;
