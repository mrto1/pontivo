-- Anmeldung: Passkeys (WebAuthn) und optionale Zwei-Faktor-Anmeldung per Authenticator-App (TOTP). SPEC 18.6
CREATE TABLE user_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX user_passkeys_user_idx ON user_passkeys (user_id);

CREATE TABLE user_totp (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  secret_enc text NOT NULL,
  confirmed_at timestamptz,
  -- letzter akzeptierter 30-Sekunden-Schritt (ein Code gilt nur einmal)
  last_step bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);
