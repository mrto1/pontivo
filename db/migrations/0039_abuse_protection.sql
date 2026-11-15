-- Missbrauchsschutz: Rate-Limit in der Datenbank (überlebt Neustarts), bestätigte E-Mail-Adresse. SPEC 18.8
CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL
);
CREATE INDEX rate_limits_window_idx ON rate_limits (window_start);

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
-- Wer sich schon per Link angemeldet hat, hat die Adresse bewiesen
UPDATE users u SET email_verified_at = (SELECT min(t.used_at) FROM login_tokens t WHERE t.user_id = u.id AND t.used_at IS NOT NULL)
 WHERE EXISTS (SELECT 1 FROM login_tokens t WHERE t.user_id = u.id AND t.used_at IS NOT NULL);
