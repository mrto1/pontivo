-- SPEC 20.1 (R1): Betriebsart Restaurant, Gastro-Bezeichnung, Öffnungszeiten, Modul «restaurant» neben «pos» (Kasse)
ALTER TABLE hotels DROP CONSTRAINT IF EXISTS hotels_property_type_check;
ALTER TABLE hotels ADD CONSTRAINT hotels_property_type_check CHECK (property_type IN ('hotel', 'bnb', 'apartment', 'chalet', 'group_house', 'restaurant'));
ALTER TABLE hotels ADD COLUMN dining_label text NOT NULL DEFAULT 'restaurant'
  CHECK (dining_label IN ('restaurant', 'cafe', 'bar', 'beiz', 'takeaway', 'kitchen'));
ALTER TABLE restaurant_settings ADD COLUMN opening_hours jsonb;

-- Bestehende Betriebe mit Kasse: Reservierungen, Speisekarte und Küche hängen neu am Modul «restaurant»
INSERT INTO hotel_modules (hotel_id, module, enabled)
SELECT hotel_id, 'restaurant', true FROM hotel_modules WHERE module = 'pos' AND enabled
ON CONFLICT (hotel_id, module) DO UPDATE SET enabled = true;
