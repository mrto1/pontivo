import { currentUserId } from "./guard";
import { roleIn } from "./session";
import { canAccess } from "../domain/roles";
import { getHotelById } from "../services/hotels";
import { moduleOn } from "../services/modules";

/**
 * Zugriff für JSON-Schnittstellen der Admin-Oberfläche (Sitzung per Cookie): Antwort 401/403/404 statt Weiterleitung.
 * Nur `application/json` wird angenommen (löst bei fremden Seiten eine Vorabprüfung aus, so kann keine fremde Seite POSTen).
 */
export async function apiHotel(req: Request, hotelId: string, area: string, moduleKey: string) {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return { error: Response.json({ error: "Content-Type muss application/json sein." }, { status: 415 }) };
  const uid = await currentUserId();
  if (!uid) return { error: Response.json({ error: "Bitte neu anmelden." }, { status: 401 }) };
  const role = await roleIn(uid, hotelId);
  if (!canAccess(role, "staff", area)) return { error: Response.json({ error: "Kein Zugriff." }, { status: 403 }) };
  const hotel = await getHotelById(hotelId);
  if (!hotel) return { error: Response.json({ error: "Betrieb nicht gefunden." }, { status: 404 }) };
  if (!(await moduleOn(hotel.id, moduleKey))) return { error: Response.json({ error: "Modul nicht aktiv." }, { status: 404 }) };
  return { hotel, actor: `user:${uid}` };
}
