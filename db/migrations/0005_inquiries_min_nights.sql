-- 0005: Anfragen (Gruppen, Seminare, Hochzeiten) aus dem Website-Baustein «Anfrage»
--       und Mindestaufenthalt pro Tarif (für Pakete wie «3 Nächte mit Halbpension»)

CREATE TABLE inquiries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  kind        text NOT NULL,                     -- group | seminar | wedding | company | other
  name        text NOT NULL,
  email       text NOT NULL,
  phone       text,
  date_from   date,
  date_to     date,
  persons     integer CHECK (persons IS NULL OR persons BETWEEN 1 AND 2000),
  message     text NOT NULL DEFAULT '',
  language    text NOT NULL DEFAULT 'de',
  page_slug   text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON inquiries(hotel_id, created_at DESC);

ALTER TABLE rate_plans ADD COLUMN min_nights integer NOT NULL DEFAULT 1 CHECK (min_nights BETWEEN 1 AND 60);
