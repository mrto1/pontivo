/** Gültige UUID (Pfadteile wie /admin/<hotelId> vor der Datenbankabfrage prüfen, sonst wirft Postgres «invalid input syntax for type uuid») */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);
