-- Adressen, an die wir nicht mehr senden: harte Bounces und Spam-Beschwerden aus den Postmark-Webhooks.
-- Plattformweit (eine Adresse, die nicht zustellbar ist, ist es für alle Hotels), daher ohne hotel_id.
CREATE TABLE email_suppressions (
  email      text PRIMARY KEY,
  reason     text NOT NULL,          -- 'bounce' | 'spam_complaint'
  bounce_type text,                  -- Postmark `Type`, z. B. HardBounce
  details    text,
  postmark_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Postmark-Ereignisse (Bounce, Spam-Beschwerde) werden ebenfalls genau einmal verarbeitet.
ALTER TABLE inbound_events DROP CONSTRAINT inbound_events_source_check;
ALTER TABLE inbound_events ADD CONSTRAINT inbound_events_source_check CHECK (source IN ('stripe','channex','postmark'));
