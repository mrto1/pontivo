-- Native App Pontivo (SPEC 19.23): Gerätekennungen für Mitteilungen (FCM/APNs). Versand folgt, sobald Firebase und Apple eingerichtet sind.
CREATE TABLE native_push_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform   text NOT NULL CHECK (platform IN ('android','ios')),
  token      text NOT NULL,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, user_id, token)
);
