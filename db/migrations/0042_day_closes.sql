-- Tagesabschluss (SPEC 19.1): Summen eines Tages, danach ist der Tag für Zahlungen und Rechnungen gesperrt
CREATE TABLE day_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  day date NOT NULL,
  totals jsonb NOT NULL,
  cash_expected_rappen integer NOT NULL DEFAULT 0,
  cash_counted_rappen integer,
  difference_rappen integer NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',
  closed_by text NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, day)
);
