-- PMS Stufe B.4: eingeschränkte Rollen (SPEC 17.4)
ALTER TABLE hotel_members DROP CONSTRAINT IF EXISTS hotel_members_role_check;
ALTER TABLE hotel_members ADD CONSTRAINT hotel_members_role_check CHECK (role IN ('owner', 'manager', 'staff', 'reception', 'housekeeping', 'accounting'));
