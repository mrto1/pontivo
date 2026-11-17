-- Datenübernahme aus der bisherigen Software (PMS-ERSATZ E1): Aufträge, Herkunft der Buchungen
CREATE TABLE import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  source_profile text NOT NULL DEFAULT 'generic',
  status text NOT NULL CHECK (status IN ('checked','running','done','undone','failed')),
  filename text NOT NULL DEFAULT '',
  -- Hochgeladener Dateiinhalt: wird nach dem Import oder Rückgängigmachen geleert (Datenschutz)
  csv text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX import_jobs_hotel ON import_jobs (hotel_id, created_at DESC);

ALTER TABLE bookings ADD COLUMN source_ref text, ADD COLUMN import_job_id uuid REFERENCES import_jobs(id);
CREATE UNIQUE INDEX bookings_source_ref ON bookings (hotel_id, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX bookings_import_job ON bookings (import_job_id) WHERE import_job_id IS NOT NULL;
ALTER TABLE guests ADD COLUMN import_job_id uuid REFERENCES import_jobs(id);

-- Herkunft «import» (übernommene Buchungen)
ALTER TABLE bookings DROP CONSTRAINT bookings_source_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_source_check CHECK (source IN ('direct','booking_com','expedia','airbnb','other_ota','admin','import'));
