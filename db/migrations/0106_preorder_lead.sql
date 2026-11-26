-- Küchenvorlauf: Vorbestellung erscheint so viele Minuten vor der Ankunft in der Küche (0 = erst beim Platzieren) (SPEC 19.60)
ALTER TABLE restaurant_settings ADD COLUMN preorder_lead_min integer NOT NULL DEFAULT 0 CHECK (preorder_lead_min BETWEEN 0 AND 240);
