-- Konzept 6: Kasse als Zusatzmodul CHF 29 pro Monat, auf der Monatsrechnung (SPEC 20.4/20.8)
ALTER TABLE platform_charges ADD COLUMN pos_module_rappen integer NOT NULL DEFAULT 0;
