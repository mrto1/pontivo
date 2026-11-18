-- API-Schlüssel mit Verwendungszweck: 'pos' (Kassen-Schnittstelle, bisher) und 'website' (eigene Website, SPEC 19.22)
ALTER TABLE api_keys ADD COLUMN scope text NOT NULL DEFAULT 'pos' CHECK (scope IN ('pos','website'));
