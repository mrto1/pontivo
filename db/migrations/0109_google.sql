-- Google (SPEC 19.67): Herkunft «google» bei Direktbuchungen, Tischreservationen und Online-Bestellungen
ALTER TABLE bookings ADD COLUMN referrer text CHECK (referrer IN ('google'));
ALTER TABLE pos_reservations ADD COLUMN referrer text CHECK (referrer IN ('google'));
ALTER TABLE online_orders ADD COLUMN referrer text CHECK (referrer IN ('google'));
