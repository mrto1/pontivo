-- Zimmerwechsel (SPEC 19.5): Verlauf je Buchungszimmer; booking_rooms.room_id bleibt das aktuelle Zimmer
CREATE TABLE room_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  booking_room_id uuid NOT NULL REFERENCES booking_rooms(id),
  from_room_id uuid NOT NULL REFERENCES rooms(id),
  to_room_id uuid NOT NULL REFERENCES rooms(id),
  move_day date NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_room_id, move_day)
);
CREATE INDEX room_moves_hotel_idx ON room_moves (hotel_id, move_day);

-- Belegung je Zimmer und Zeitraum (ein Zeitraum = Nächte [from_day, to_day)), berücksichtigt Zimmerwechsel
CREATE VIEW room_stays AS
SELECT br.id AS booking_room_id, br.booking_id, br.hotel_id, br.room_id, b.checkin AS from_day, b.checkout AS to_day
  FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
 WHERE br.room_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM room_moves m WHERE m.booking_room_id = br.id)
UNION ALL
SELECT m.booking_room_id, br.booking_id, br.hotel_id, m.from_room_id, b.checkin, m.move_day
  FROM room_moves m JOIN booking_rooms br ON br.id = m.booking_room_id JOIN bookings b ON b.id = br.booking_id
 WHERE m.move_day = (SELECT min(x.move_day) FROM room_moves x WHERE x.booking_room_id = m.booking_room_id)
UNION ALL
SELECT m.booking_room_id, br.booking_id, br.hotel_id, m.to_room_id, m.move_day,
       COALESCE((SELECT min(x.move_day) FROM room_moves x WHERE x.booking_room_id = m.booking_room_id AND x.move_day > m.move_day), b.checkout)
  FROM room_moves m JOIN booking_rooms br ON br.id = m.booking_room_id JOIN bookings b ON b.id = br.booking_id;
