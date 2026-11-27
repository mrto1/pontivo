-- SMS-Erinnerung vor Tischreservationen (SPEC 19.68): freiwillig, Kosten trägt der Betrieb (Monatsrechnung, Selbstkosten je SMS)
ALTER TABLE restaurant_settings ADD COLUMN sms_reminder boolean NOT NULL DEFAULT false;
ALTER TABLE restaurant_settings ADD COLUMN sms_reminder_hours integer NOT NULL DEFAULT 3 CHECK (sms_reminder_hours BETWEEN 1 AND 48);
ALTER TABLE restaurant_settings ADD COLUMN sms_reminder_accepted_at timestamptz;
ALTER TABLE pos_reservations ADD COLUMN sms_reminder_sent_at timestamptz;
