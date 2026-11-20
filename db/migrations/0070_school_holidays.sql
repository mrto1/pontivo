-- Schulferien je Kanton (SPEC 19.33): Referenzdaten der Plattform, von der Plattform-Verwaltung importiert (keine Mandantendaten)
CREATE TABLE school_holidays (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canton     char(2) NOT NULL,
  name       text NOT NULL,
  from_day   date NOT NULL,
  to_day     date NOT NULL CHECK (to_day >= from_day),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canton, name, from_day)
);
CREATE INDEX school_holidays_canton_idx ON school_holidays (canton, from_day);
