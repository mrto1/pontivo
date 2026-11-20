-- Team: Standardrollen (Rezeption, Reinigung, Buchhaltung, Service) je Betrieb anpassen: eigener Name und eigene Seiten.
-- Ohne Zeile gelten Name und Seiten aus dem Code; «Zurücksetzen» löscht die Zeile.
CREATE TABLE hotel_role_overrides (
  hotel_id   uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('reception', 'housekeeping', 'accounting', 'service')),
  name       text,
  areas      text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, role)
);
