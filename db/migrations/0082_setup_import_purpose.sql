-- KI-Speisekarte (SPEC 19.49 Etappe D): derselbe Lauf-Speicher, getrennt nach Zweck (Hotel-Einrichtung oder Speisekarte)
ALTER TABLE setup_imports ADD COLUMN purpose text NOT NULL DEFAULT 'hotel' CHECK (purpose IN ('hotel','menu'));
