import { rateLimitDb } from "./rate-limit-db";

const LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;

/** Schutz vor Dauer-Abrufen: höchstens 20 Exporte je Person und Betrieb in 10 Minuten, danach 429 mit Wartezeit. Gibt null zurück, wenn der Export erlaubt ist. */
export async function exportLimited(userId: string, hotelId: string): Promise<Response | null> {
  if (await rateLimitDb(`export:${hotelId}:${userId}`, LIMIT, WINDOW_MS)) return null;
  return new Response("Zu viele Exporte. Bitte in einigen Minuten erneut versuchen.", { status: 429, headers: { "retry-after": String(WINDOW_MS / 1000), "cache-control": "no-store" } });
}
