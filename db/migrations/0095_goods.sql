-- Shop & Lager (SPEC 19.51): Waren mit Preis, Minibar-Zuweisung und optionalem Bestand; für Unterkünfte und Restaurants
CREATE TABLE goods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  name text NOT NULL,
  category text NOT NULL DEFAULT '',
  price_rappen integer NOT NULL DEFAULT 0 CHECK (price_rappen >= 0),
  vat text NOT NULL DEFAULT 'standard' CHECK (vat IN ('standard','reduced','none')),
  sellable boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  minibar boolean NOT NULL DEFAULT false,
  minibar_par integer NOT NULL DEFAULT 0 CHECK (minibar_par BETWEEN 0 AND 99),
  track_stock boolean NOT NULL DEFAULT false,
  stock integer NOT NULL DEFAULT 0,
  min_stock integer NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goods_hotel_idx ON goods (hotel_id);
