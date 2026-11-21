-- «An- & Abreisen» (frontdesk) ist in den Reiter «Tag» aufgegangen: Bereich in eigenen und angepassten Rollen umbenennen
UPDATE hotel_roles SET areas = array_replace(areas, 'frontdesk', 'tag') WHERE 'frontdesk' = ANY(areas);
UPDATE hotel_role_overrides SET areas = array_replace(areas, 'frontdesk', 'tag') WHERE 'frontdesk' = ANY(areas);
