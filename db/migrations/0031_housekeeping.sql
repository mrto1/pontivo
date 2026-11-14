-- PMS Stufe B.1: Housekeeping (SPEC 17.1)
ALTER TABLE rooms ADD COLUMN clean_status text NOT NULL DEFAULT 'clean' CHECK (clean_status IN ('dirty', 'clean', 'inspected'));
ALTER TABLE rooms ADD COLUMN status_changed_at timestamptz;
ALTER TABLE rooms ADD COLUMN status_changed_by text;

CREATE TABLE housekeeping_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('checkout', 'stay', 'other')),
  day date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  note text NOT NULL DEFAULT '',
  done_at timestamptz,
  done_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, room_id, day, kind)
);
CREATE INDEX housekeeping_tasks_day ON housekeeping_tasks (hotel_id, day, status);

CREATE TABLE room_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  reported_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  done_by text
);
CREATE INDEX room_issues_open ON room_issues (hotel_id, status);
