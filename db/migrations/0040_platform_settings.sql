-- Einstellungen der Plattform selbst (z. B. Texte der Pontivo-Startseite, bearbeitbar im Plattform-Admin). SPEC 18.9
CREATE TABLE platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
