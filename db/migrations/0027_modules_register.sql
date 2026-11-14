-- Modul-Register (SPEC 16.1): erlaubte Modulnamen stehen im Code (src/domain/modules.ts), nicht mehr als feste Liste in der Datenbank
ALTER TABLE hotel_modules DROP CONSTRAINT IF EXISTS hotel_modules_module_check;
