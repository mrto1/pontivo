-- Restaurant: Kellner und Zuweisung zu Tischen (SPEC 19.54)
CREATE TABLE pos_waiters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#0b7285' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_waiters_hotel_idx ON pos_waiters (hotel_id);
ALTER TABLE pos_tables ADD COLUMN waiter_id uuid REFERENCES pos_waiters(id) ON DELETE SET NULL;
