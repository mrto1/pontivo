-- 0007: Gutschein bei der Online-Buchung einlösen
-- Der Gutscheinbetrag wird beim Reservieren (Hold) abgezogen und bei Ablauf/Storno wieder gutgeschrieben.

ALTER TABLE bookings ADD COLUMN voucher_id uuid REFERENCES vouchers(id);
ALTER TABLE bookings ADD COLUMN voucher_rappen integer NOT NULL DEFAULT 0 CHECK (voucher_rappen >= 0);
ALTER TABLE bookings ADD CONSTRAINT bookings_voucher_le_total CHECK (voucher_rappen <= total_rappen);

-- Einlösungen können zu einer Buchung gehören; negative Beträge = Gutschrift (Ablauf, Storno)
ALTER TABLE voucher_redemptions ADD COLUMN booking_id uuid REFERENCES bookings(id);
ALTER TABLE voucher_redemptions DROP CONSTRAINT voucher_redemptions_amount_rappen_check;
ALTER TABLE voucher_redemptions ADD CONSTRAINT voucher_redemptions_amount_nonzero CHECK (amount_rappen <> 0);
CREATE INDEX ON voucher_redemptions(booking_id);
