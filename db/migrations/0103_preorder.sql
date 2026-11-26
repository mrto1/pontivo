-- Vorbestellung zur Tischreservierung mit Vorauszahlung (SPEC 19.57)
ALTER TABLE pos_reservations
  ADD COLUMN preorder jsonb,
  ADD COLUMN preorder_rappen integer NOT NULL DEFAULT 0 CHECK (preorder_rappen >= 0),
  ADD COLUMN preorder_order_id uuid;
ALTER TABLE restaurant_settings
  ADD COLUMN preorder_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN preorder_required_from integer NOT NULL DEFAULT 0 CHECK (preorder_required_from BETWEEN 0 AND 50);
