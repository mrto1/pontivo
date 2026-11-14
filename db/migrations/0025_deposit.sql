-- Anzahlung (SPEC 5.9): Anteil bei Buchung, Rest vor der Anreise per Zahlungslink
ALTER TABLE hotels
  ADD COLUMN deposit_bps integer NOT NULL DEFAULT 10000 CHECK (deposit_bps BETWEEN 1000 AND 10000), -- 10000 = volle Zahlung (Anzahlung aus)
  ADD COLUMN balance_due_days integer NOT NULL DEFAULT 7 CHECK (balance_due_days BETWEEN 1 AND 60);

ALTER TABLE bookings
  ADD COLUMN balance_rappen integer NOT NULL DEFAULT 0 CHECK (balance_rappen >= 0),
  ADD COLUMN balance_due_on date,
  ADD COLUMN balance_paid_at timestamptz,
  ADD COLUMN balance_onsite_at timestamptz, -- Hotel hat den Rest vor Ort erhalten
  ADD COLUMN balance_requested_at timestamptz,
  ADD COLUMN balance_reminded_at timestamptz,
  ADD COLUMN balance_alerted_at timestamptz;

ALTER TABLE payments ADD COLUMN kind text NOT NULL DEFAULT 'full' CHECK (kind IN ('full', 'deposit', 'balance'));
