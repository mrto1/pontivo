-- Halbpension mit Tisch: Hotelgäste mit Halbpension/Vollpension bekommen automatisch einen Tisch (SPEC 19.62)
ALTER TABLE pos_reservations ADD COLUMN booking_id uuid;
CREATE UNIQUE INDEX pos_reservations_booking_day_uq ON pos_reservations (booking_id, day) WHERE booking_id IS NOT NULL;
ALTER TABLE restaurant_settings ADD COLUMN halfboard_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE restaurant_settings ADD COLUMN halfboard_time text NOT NULL DEFAULT '19:00' CHECK (halfboard_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
