-- Modul «Gäste» (SPEC 14): Geburtsdatum, Ausweisnummer und Unterschrift verschlüsselt (Anwendungsschicht),
-- Teilnehmerliste für Gruppen, Regel «Teilnehmerliste erlaubt» pro Kanton.
ALTER TABLE guest_registrations DROP COLUMN birth_date;
ALTER TABLE guest_registrations ADD COLUMN birth_date_enc text;
ALTER TABLE guest_registrations RENAME COLUMN id_document_number TO id_document_number_enc;
ALTER TABLE guest_registrations DROP COLUMN signature_png_url;
ALTER TABLE guest_registrations ADD COLUMN signature_png_enc text;   -- PNG als data-URL, verschlüsselt; nur wenn Kanton Unterschrift verlangt
ALTER TABLE guest_registrations ADD COLUMN list_only boolean NOT NULL DEFAULT false;  -- Gruppe: nur Name, Geburtsdatum, Nationalität
ALTER TABLE guest_registrations ADD COLUMN age_at_arrival integer;   -- für die Kurtaxe-Liste ohne Entschlüsselung
CREATE INDEX ON guest_registrations(booking_id);

ALTER TABLE canton_rules ADD COLUMN group_list_allowed boolean NOT NULL DEFAULT false;
UPDATE canton_rules SET group_list_allowed = true WHERE canton = 'SG';
