-- Tische zusammenlegen: eine Reservierung kann mehrere Tische belegen (SPEC 19.58)
ALTER TABLE pos_reservations ADD COLUMN extra_table_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE restaurant_settings ADD COLUMN combine_tables boolean NOT NULL DEFAULT false;
