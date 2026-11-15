-- Posteingang (SPEC 19.9): Gästenachrichten der Portale über Channex (Messages-App)
CREATE TABLE inbox_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  channex_thread_id text NOT NULL UNIQUE,
  booking_id uuid REFERENCES bookings(id),
  provider text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  is_closed boolean NOT NULL DEFAULT false,
  unread integer NOT NULL DEFAULT 0,
  last_message text NOT NULL DEFAULT '',
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inbox_threads_hotel_idx ON inbox_threads (hotel_id, is_closed, last_message_at DESC);
CREATE TABLE inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  thread_id uuid NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
  channex_message_id text NOT NULL,
  sender text NOT NULL,
  body text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]',
  sent_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, channex_message_id)
);
CREATE INDEX inbox_messages_thread_idx ON inbox_messages (thread_id, created_at);
