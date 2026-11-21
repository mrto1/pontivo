-- Gebührenregel (Konzept Entscheid 10, SPEC 18.4): Plattformgebühr am Terminal nur auf den offenen Anteil von Direktbuchungen
ALTER TABLE terminal_payments ADD COLUMN application_fee_rappen integer NOT NULL DEFAULT 0 CHECK (application_fee_rappen >= 0);
