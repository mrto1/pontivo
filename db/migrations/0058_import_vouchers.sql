-- Datenübernahme: Gutscheine tragen den Auftrag, der sie angelegt hat
ALTER TABLE vouchers ADD COLUMN import_job_id uuid REFERENCES import_jobs(id);
CREATE INDEX vouchers_import_job ON vouchers (import_job_id) WHERE import_job_id IS NOT NULL;
