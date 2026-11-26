-- Bestellen am Tisch per QR-Code (SPEC 19.61)
ALTER TABLE restaurant_settings ADD COLUMN qr_ordering boolean NOT NULL DEFAULT false;
