-- Küchenbildschirm (SPEC 19.49 Etappe B): Station je Artikel, «fertig» je Bestellzeile (Bestellzeilen selbst bleiben unveränderbar)
ALTER TABLE pos_items ADD COLUMN station text NOT NULL DEFAULT 'kitchen' CHECK (station IN ('kitchen','bar','none'));

CREATE TABLE pos_line_done (
  line_id uuid PRIMARY KEY,
  hotel_id uuid NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  done_by text NOT NULL
);
CREATE INDEX pos_line_done_hotel_idx ON pos_line_done (hotel_id);
