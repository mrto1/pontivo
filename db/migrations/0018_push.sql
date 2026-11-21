-- Push-Mitteilungen für den Admin (Web Push, VAPID): Geräte der Hotel-Mitarbeitenden und Ausgangswarteschlange
CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, endpoint)
);
CREATE INDEX push_subscriptions_hotel_idx ON push_subscriptions (hotel_id);

CREATE TABLE push_outbox (
  id          bigserial PRIMARY KEY,
  hotel_id    uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  dedupe_key  text NOT NULL,                 -- z. B. "booking_new:<buchung>": pro Ereignis nur eine Mitteilung
  title       text NOT NULL,
  body        text NOT NULL,
  url         text NOT NULL,                 -- relativer Pfad unter /admin/
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled')),
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  UNIQUE (hotel_id, dedupe_key)
);
CREATE INDEX push_outbox_pending_idx ON push_outbox (id) WHERE status = 'pending';
