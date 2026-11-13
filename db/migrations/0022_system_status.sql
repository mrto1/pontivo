-- Überwachung: Lebenszeichen des Workers und Zeitpunkt gesendeter Alarme (Wiederholung begrenzen)
CREATE TABLE system_status (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
