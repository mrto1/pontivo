-- Paket «Personal in Rezeption und Reinigung» (Einrichtung): wer die Rezeption nutzt, bekommt auch die Reinigung (Housekeeping).
-- Nur Betriebe mit Unterkunft; Daten bleiben unverändert, nur der Menüpunkt erscheint.
INSERT INTO hotel_modules (hotel_id, module, enabled)
SELECT hm.hotel_id, 'housekeeping', true
  FROM hotel_modules hm JOIN hotels h ON h.id = hm.hotel_id
 WHERE hm.module = 'frontdesk' AND hm.enabled AND h.property_type <> 'restaurant'
ON CONFLICT (hotel_id, module) DO UPDATE SET enabled = true;
