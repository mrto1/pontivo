-- Airbnb über Channex (OAuth-Link). Airbnb hat keine Hotel-ID wie Booking.com; die Verbindung entsteht bei der Freigabe auf Airbnb.
ALTER TABLE channex_channels DROP CONSTRAINT channex_channels_channel_check;
ALTER TABLE channex_channels ADD CONSTRAINT channex_channels_channel_check CHECK (channel IN ('BookingCom','Airbnb'));
ALTER TABLE channex_channels ALTER COLUMN external_id DROP NOT NULL;
-- Einmal-Token für die Rückkehr von Airbnb (wird im Rücksprung-Link von Channex zurückgegeben)
ALTER TABLE channex_channels ADD COLUMN auth_token text;
ALTER TABLE channex_channels ADD COLUMN auth_expires_at timestamptz;
