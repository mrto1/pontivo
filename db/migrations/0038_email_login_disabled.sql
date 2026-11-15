-- Anmeldung nur per Passkey (E-Mail-Link-Anmeldung abgeschaltet, freiwillig, braucht mind. 2 Passkeys). SPEC 18.6
ALTER TABLE users ADD COLUMN email_login_disabled boolean NOT NULL DEFAULT false;
