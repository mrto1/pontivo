import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { hotels, type ApiKey, type Hotel } from "../db/schema";
import { bearer } from "../domain/posbridge";
import { ipAllowed } from "../domain/webhooks";
import { authenticate } from "../services/posbridge";
import { moduleOn } from "../services/modules";
import { clientIp, rateLimit } from "./rate-limit";

/** Gemeinsame Kopfzeilen: nie zwischenspeichern, kein Inhaltstyp-Raten, keine Einbettung */
const BASE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'" };
export const apiJson = (data: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(data, { status, headers: { ...BASE_HEADERS, ...extra } });
export const apiError = (status: number, code: string, message: string, extra: Record<string, string> = {}) => apiJson({ error: code, message }, status, extra);

export const MAX_BODY_BYTES = 64 * 1024;

/** Rumpf lesen, höchstens 64 KB; sonst null */
export async function readBody(req: Request): Promise<string | null> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return null;
  const text = await req.text();
  return Buffer.byteLength(text) > MAX_BODY_BYTES ? null : text;
}

/**
 * Website-Schnittstelle (SPEC 19.22): Schlüssel prüfen (Bearer pnt_…, Zweck «website», nicht abgelaufen, IP erlaubt),
 * Modul `api`, Grenze je Schlüssel. Der Betrieb kommt immer aus dem Schlüssel, nie aus der Anfrage.
 */
export async function websiteAuth(req: Request, perMinute = 60): Promise<{ key: ApiKey; hotel: Hotel } | Response> {
  const token = bearer(req.headers.get("authorization"));
  if (!token) return apiError(401, "unauthorized", "API-Schlüssel fehlt.");
  const key = await authenticate(token);
  if (!key) return apiError(401, "unauthorized", "API-Schlüssel ungültig, widerrufen oder abgelaufen.");
  if (key.scope !== "website") return apiError(403, "wrong_scope", "Dieser Schlüssel ist für die Kasse, nicht für die Website-Schnittstelle.");
  if (!ipAllowed(key.allowedIps, clientIp(req))) return apiError(403, "ip_not_allowed", "Aufruf von dieser IP-Adresse ist für den Schlüssel nicht erlaubt.");
  if (!rateLimit(`api:${key.id}`, perMinute, 60_000)) return apiError(429, "rate_limited", `Zu viele Anfragen (höchstens ${perMinute} pro Minute).`, { "retry-after": "60" });
  if (!(await moduleOn(key.hotelId, "api"))) return apiError(403, "module_off", "Die Website-Schnittstelle ist für diesen Betrieb nicht aktiv.");
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, key.hotelId));
  if (!hotel) return apiError(404, "not_found", "Betrieb nicht gefunden.");
  return { key, hotel };
}
