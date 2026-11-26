-- Online-Buchung steuern: Raum/Tisch online buchbar, Küchentakt (Gäste pro Beginnzeit) (SPEC 19.59)
ALTER TABLE pos_areas ADD COLUMN online boolean NOT NULL DEFAULT true;
ALTER TABLE pos_tables ADD COLUMN online boolean NOT NULL DEFAULT true;
ALTER TABLE restaurant_settings ADD COLUMN slot_max_guests integer NOT NULL DEFAULT 0 CHECK (slot_max_guests BETWEEN 0 AND 1000);
