-- Tischreservation über das Anfrageformular: gewünschte Uhrzeit
ALTER TABLE inquiries ADD COLUMN time_of_day text CHECK (time_of_day IS NULL OR time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
