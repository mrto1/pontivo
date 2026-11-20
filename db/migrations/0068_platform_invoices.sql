-- Rechnung an das Hotel (SPEC 19.30); der MWST-Schalter liegt in platform_settings (Schlüssel «vat»)

CREATE SEQUENCE platform_invoice_seq START 1;

ALTER TABLE platform_charges
  ADD COLUMN net_rappen   integer NOT NULL DEFAULT 0,   -- Wert aller Leistungen des Monats ohne MWST
  ADD COLUMN vat_bps      integer NOT NULL DEFAULT 0,
  ADD COLUMN vat_rappen   integer NOT NULL DEFAULT 0,
  ADD COLUMN vat_number   text,                          -- MWST-Nr. der Plattform zum Zeitpunkt der Rechnung
  ADD COLUMN invoice_no   text UNIQUE,
  ADD COLUMN invoice_date date;

-- bisherige Zeilen: Betrag ohne MWST = belasteter Betrag, keine Rechnungsnummer
UPDATE platform_charges SET net_rappen = charge_rappen WHERE net_rappen = 0;
