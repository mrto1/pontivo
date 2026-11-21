-- Anmeldung mit Passwort (SPEC 19.43): scrypt-Hash, leer = noch kein Passwort (Anmeldung weiter per Passkey oder E-Mail-Link)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
