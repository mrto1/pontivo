-- Rechnung per E-Mail (SPEC 16.3): wann die Rechnung zuletzt gemailt wurde
ALTER TABLE invoices ADD COLUMN emailed_at timestamptz;
