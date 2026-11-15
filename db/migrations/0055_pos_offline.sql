-- Offline-Kasse: ein Gerätecode gehört genau einem Browser (Schlüssel), Lebenszeichen und nicht übertragene Vorgänge
ALTER TABLE pos_devices ADD COLUMN claimed_key text;
ALTER TABLE pos_devices ADD COLUMN last_seen_at timestamptz;
ALTER TABLE pos_devices ADD COLUMN pending_ops integer NOT NULL DEFAULT 0 CHECK (pending_ops >= 0);
