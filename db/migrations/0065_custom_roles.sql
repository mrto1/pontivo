-- Team: frei konfigurierbare Rollen je Betrieb (Seiten per Häkchen). Mitglieder verweisen mit role = 'custom:<id>' darauf.
CREATE TABLE hotel_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name       text NOT NULL,
  areas      text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, name)
);
CREATE INDEX hotel_roles_hotel ON hotel_roles (hotel_id);

ALTER TABLE hotel_members DROP CONSTRAINT IF EXISTS hotel_members_role_check;
ALTER TABLE hotel_members ADD CONSTRAINT hotel_members_role_check
  CHECK (role IN ('owner', 'manager', 'staff', 'reception', 'housekeeping', 'accounting', 'service') OR role ~ '^custom:[0-9a-f-]{36}$');
