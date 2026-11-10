-- Selbst-Registrierung, Einrichtungs-Assistent und Mindestgebühr (1 %, mindestens CHF 19 pro Monat)
ALTER TABLE hotels ADD COLUMN property_type text NOT NULL DEFAULT 'hotel'
  CHECK (property_type IN ('hotel', 'bnb', 'apartment', 'chalet', 'group_house'));
ALTER TABLE hotels ADD COLUMN monthly_minimum_rappen integer NOT NULL DEFAULT 0 CHECK (monthly_minimum_rappen BETWEEN 0 AND 1000000);
ALTER TABLE hotels ADD COLUMN host_terms_version text;
ALTER TABLE hotels ADD COLUMN host_terms_accepted_at timestamptz;
ALTER TABLE hotels ADD COLUMN live_since timestamptz;
-- Karte für die Mindestgebühr: Kunde und Zahlungsmittel auf dem Plattform-Konto (nie Kartendaten selbst)
ALTER TABLE hotels ADD COLUMN billing_customer_id text;
ALTER TABLE hotels ADD COLUMN billing_payment_method_id text;
ALTER TABLE hotels ADD COLUMN billing_card_label text;
-- Einrichtungsstand: {startedAt, completedAt, reminders: n, alertedAt}
ALTER TABLE hotels ADD COLUMN onboarding jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Fester Anreisetag (z. B. Samstag bei Ferienwohnungen); leer = jeder Tag. 0 = Sonntag … 6 = Samstag
ALTER TABLE rate_plans ADD COLUMN arrival_weekdays integer[] NOT NULL DEFAULT '{}';

-- Monatliche Abrechnung der Mindestgebühr
CREATE TABLE platform_charges (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                 uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  month                    text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  fees_rappen              integer NOT NULL,          -- verdiente 1 % im Monat (netto)
  minimum_rappen           integer NOT NULL,
  charge_rappen            integer NOT NULL,          -- Differenz, die belastet wird (0 = nichts)
  status                   text NOT NULL CHECK (status IN ('none', 'pending', 'succeeded', 'failed')),
  stripe_payment_intent_id text,
  error                    text,
  attempts                 integer NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, month)
);
