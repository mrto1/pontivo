-- SPEC 20.4 (Entscheid 21.11.2026): Online-Bestellung vorerst mit fester Monatspauschale statt 1,9 % (Plattformbesteuerung, ESTV-Anfrage offen)
ALTER TABLE platform_charges ADD COLUMN order_module_rappen integer NOT NULL DEFAULT 0;
