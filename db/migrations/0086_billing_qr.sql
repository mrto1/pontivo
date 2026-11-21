-- SPEC 20.6: Grundgebühr per Karte oder QR-Rechnung, Mahnwesen der Plattform
ALTER TABLE hotels ADD COLUMN billing_method text NOT NULL DEFAULT 'card' CHECK (billing_method IN ('card', 'qr'));

ALTER TABLE platform_charges
  ADD COLUMN method text NOT NULL DEFAULT 'card' CHECK (method IN ('card', 'qr')),
  ADD COLUMN due_date date,
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN paid_ref text,
  ADD COLUMN paid_note text NOT NULL DEFAULT '',
  ADD COLUMN dunning_level integer NOT NULL DEFAULT 0,
  ADD COLUMN dunned_at timestamptz;

ALTER TABLE platform_charges DROP CONSTRAINT IF EXISTS platform_charges_status_check;
ALTER TABLE platform_charges ADD CONSTRAINT platform_charges_status_check CHECK (status IN ('none', 'pending', 'succeeded', 'failed', 'invoiced'));
CREATE UNIQUE INDEX platform_charges_paid_ref_idx ON platform_charges (paid_ref) WHERE paid_ref IS NOT NULL;
