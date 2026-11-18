import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { hotels, type ApiKey, type Hotel } from "../db/schema";
import { bearer } from "../domain/posbridge";
import { authenticate } from "../services/posbridge";
import { moduleOn } from "../services/modules";
import { rateLimit } from "./rate-limit";

export const apiError = (status: number, code: string, message: string) => Response.json({ error: code, message }, { status });

/**
 * Website-Schnittstelle (SPEC 19.22): Schlüssel prüfen (Bearer pnt_…, Zweck «website»), Modul `api`, Grenze je Schlüssel.
 * Der Betrieb kommt immer aus dem Schlüssel, nie aus der Anfrage.
 */
export async function websiteAuth(req: Request, perMinute = 60): Promise<{ key: ApiKey; hotel: Hotel } | Response> {
  const token = bearer(req.headers.get("authorization"));
  if (!token) return apiError(401, "unauthorized", "API-Schlüssel fehlt.");
  const key = await authenticate(token);
  if (!key) return apiError(401, "unauthorized", "API-Schlüssel ungültig oder widerrufen.");
  if (key.scope !== "website") return apiError(403, "wrong_scope", "Dieser Schlüssel ist für die Kasse, nicht für die Website-Schnittstelle.");
  if (!rateLimit(`api:${key.id}`, perMinute, 60_000)) return apiError(429, "rate_limited", `Zu viele Anfragen (höchstens ${perMinute} pro Minute).`);
  if (!(await moduleOn(key.hotelId, "api"))) return apiError(403, "module_off", "Die Website-Schnittstelle ist für diesen Betrieb nicht aktiv.");
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, key.hotelId));
  if (!hotel) return apiError(404, "not_found", "Betrieb nicht gefunden.");
  return { key, hotel };
}
