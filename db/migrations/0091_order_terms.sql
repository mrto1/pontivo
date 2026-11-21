-- SPEC 20.4: Pilotbedingungen Online-Bestellung beim ersten Einschalten bestätigt; Hinweis vor Ende des Sonderangebots
ALTER TABLE online_order_settings ADD COLUMN terms_version text;
ALTER TABLE online_order_settings ADD COLUMN terms_accepted_at timestamptz;
ALTER TABLE online_order_settings ADD COLUMN intro_notice_at timestamptz;
