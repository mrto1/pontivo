-- PMS Stufe B.2: Gäste-Notizen und Tags (SPEC 17.2), pro Betrieb und E-Mail-Adresse
CREATE TABLE guest_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  email text NOT NULL, -- kleingeschrieben
  note text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, email)
);
