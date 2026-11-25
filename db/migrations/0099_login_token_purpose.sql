-- Aktivierungslink (E-Mail bestätigen, ohne Anmeldung) und Login-Link sind getrennte Zwecke: ein Aktivierungslink meldet nie an.
ALTER TABLE login_tokens ADD COLUMN purpose text NOT NULL DEFAULT 'login';
