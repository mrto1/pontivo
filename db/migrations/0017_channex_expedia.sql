-- Expedia über Channex (Channel API, gleicher Ablauf wie Booking.com)
ALTER TABLE channex_channels DROP CONSTRAINT channex_channels_channel_check;
ALTER TABLE channex_channels ADD CONSTRAINT channex_channels_channel_check CHECK (channel IN ('BookingCom','Airbnb','Expedia'));
