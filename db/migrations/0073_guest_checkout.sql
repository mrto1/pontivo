-- Gästeportal Phase 2 (SPEC 19.41): Gast meldet den Check-out selbst im Portal
ALTER TABLE bookings ADD COLUMN guest_checkout_at timestamptz;
