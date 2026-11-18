-- KI-Zusatz: Tarif, der KI-Chat und KI-Preisempfehlung zusammen einschaltet (CHF 29 pro Monat ohne MWST)
ALTER TABLE ai_plans ADD COLUMN includes_pricing boolean NOT NULL DEFAULT false;
INSERT INTO ai_plans (code, name, price_rappen, included_conversations, pack_size, pack_price_rappen, active, includes_pricing)
  VALUES ('zusatz', 'KI-Zusatz (Chat und Preisempfehlung)', 2900, 250, 100, 500, true, true);
-- Die Preisempfehlung hängt ab jetzt am gebuchten KI-Zusatz, nicht mehr an einem frei schaltbaren Modul
DELETE FROM hotel_modules WHERE module = 'ai_pricing';
