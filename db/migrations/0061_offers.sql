-- Angebote (Seminar, Gruppe, Fest): aus einer Anfrage erstellt, per Link angenommen, Raumbuchungen entstehen bei Annahme
CREATE TABLE offers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  inquiry_id     uuid REFERENCES inquiries(id) ON DELETE SET NULL,
  seq            integer NOT NULL,
  public_token   text NOT NULL UNIQUE,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','declined','expired')),
  customer_name  text NOT NULL,
  customer_email text NOT NULL,
  company        text NOT NULL DEFAULT '',
  title          text NOT NULL,
  intro          text NOT NULL DEFAULT '',
  language       text NOT NULL DEFAULT 'de',
  valid_until    date NOT NULL,
  sent_at        timestamptz,
  decided_at     timestamptz,
  decision_note  text NOT NULL DEFAULT '',
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, seq)
);
CREATE INDEX offers_hotel ON offers (hotel_id, created_at DESC);

CREATE TABLE offer_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id     uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  hotel_id     uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  position     integer NOT NULL,
  description  text NOT NULL,
  quantity     integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_rappen  integer NOT NULL,
  vat_kind     text NOT NULL DEFAULT 'standard' CHECK (vat_kind IN ('stay','standard','none')),
  -- Zeile reserviert einen Raum/ein Angebot vor Ort (nur bei Annahme)
  resource_id  uuid REFERENCES resources(id) ON DELETE SET NULL,
  day          date,
  start_min    integer,
  end_min      integer,
  persons      integer,
  resource_booking_id uuid REFERENCES resource_bookings(id) ON DELETE SET NULL
);
CREATE INDEX offer_lines_offer ON offer_lines (offer_id, position);
