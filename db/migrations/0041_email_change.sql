-- E-Mail-Adresse des eigenen Kontos ändern (Bestätigung per Link an die neue Adresse). SPEC 18.10
CREATE TABLE email_changes (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  new_email text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_changes_user_idx ON email_changes (user_id);
