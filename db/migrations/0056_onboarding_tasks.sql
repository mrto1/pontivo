-- Einarbeitung: erledigte Aufgaben der Checkliste «Erste Woche», je Person und Betrieb
CREATE TABLE onboarding_tasks (
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_key text NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, user_id, task_key)
);
