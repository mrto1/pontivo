-- Kasse und Lager (SPEC 19.51): Kassenartikel kann mit einer Ware aus «Shop & Lager» verknüpft sein; Verkauf senkt den Bestand
ALTER TABLE pos_items ADD COLUMN good_id uuid REFERENCES goods(id) ON DELETE SET NULL;
