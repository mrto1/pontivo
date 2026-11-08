-- 0004: Tarif in Channex als "per_person" angelegt (Preis je Anzahl Erwachsene statt ein Preis pro Zimmer)

ALTER TABLE rate_plans ADD COLUMN channex_per_person boolean NOT NULL DEFAULT false;
