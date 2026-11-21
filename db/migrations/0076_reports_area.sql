-- «Check-in & Meldeschein» (guests) ist in Tagesliste und «Berichte» (reports) aufgegangen: Bereich in eigenen und angepassten Rollen umbenennen
UPDATE hotel_roles SET areas = array_replace(areas, 'guests', 'reports') WHERE 'guests' = ANY(areas);
UPDATE hotel_role_overrides SET areas = array_replace(areas, 'guests', 'reports') WHERE 'guests' = ANY(areas);
