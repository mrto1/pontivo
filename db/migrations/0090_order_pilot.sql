-- SPEC 20.4 (Entscheid 21.11.2026): Sonderangebot 3 Monate pauschal ab erstem Einschalten, Pilotbetriebe mit Kostendach
ALTER TABLE online_order_settings ADD COLUMN started_on date;
ALTER TABLE online_order_settings ADD COLUMN pilot_until date;
-- Bereits eingeschaltete Betriebe: Start = erste echte Bestellung, sonst heute
UPDATE online_order_settings s SET started_on = coalesce((SELECT min(o.day) FROM online_orders o WHERE o.hotel_id = s.hotel_id AND NOT o.is_test), current_date)
 WHERE s.enabled;
