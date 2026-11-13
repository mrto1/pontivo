-- Plattformgebühr: neuer Standard 1,9 % (190 Basispunkte). Es gibt noch keine zahlenden Hotels; Demo- und Testbetriebe mit 1 % ziehen mit.
ALTER TABLE hotels ALTER COLUMN platform_fee_bps SET DEFAULT 190;
UPDATE hotels SET platform_fee_bps = 190 WHERE platform_fee_bps = 100;
