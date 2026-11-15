-- Pauschalen (SPEC 19.4): Verpflegungsart je Tarif, Wert der Verpflegung für die MWST-Aufteilung
ALTER TABLE rate_plans ADD COLUMN board text NOT NULL DEFAULT 'none' CHECK (board IN ('none','breakfast','half','full'));
ALTER TABLE rate_plans ADD COLUMN meal_rappen integer NOT NULL DEFAULT 0 CHECK (meal_rappen >= 0);
UPDATE rate_plans SET board = 'breakfast' WHERE breakfast_included;
