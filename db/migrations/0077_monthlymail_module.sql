-- Monatsmail ist jetzt eine Funktion (hotel_modules 'monthlymail', Standard aus). Wer sie bisher ausdrücklich eingeschaltet hatte, behält sie.
INSERT INTO hotel_modules (hotel_id, module, enabled)
SELECT id, 'monthlymail', true FROM hotels WHERE content->>'monthlyMail' = 'true'
ON CONFLICT (hotel_id, module) DO NOTHING;
