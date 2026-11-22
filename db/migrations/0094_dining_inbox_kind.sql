-- Getrennter Posteingang (SPEC 20.1): neue Art «dininginbox» (Tischanfragen im Posteingang der Gastronomie)
ALTER TABLE user_seen DROP CONSTRAINT user_seen_kind_check;
ALTER TABLE user_seen ADD CONSTRAINT user_seen_kind_check CHECK (kind IN ('inbox','dininginbox','bookings','reservations','orders'));
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_kind_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check CHECK (kind IN ('inbox','dininginbox','bookings','reservations','orders','other'));
ALTER TABLE push_prefs DROP CONSTRAINT push_prefs_kind_check;
ALTER TABLE push_prefs ADD CONSTRAINT push_prefs_kind_check CHECK (kind IN ('inbox','dininginbox','bookings','reservations','orders','other'));
