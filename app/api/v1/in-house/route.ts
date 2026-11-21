import { bearer } from "@/src/domain/posbridge";
import { authenticate, inHouseForBridge } from "@/src/services/posbridge";
import { moduleOn } from "@/src/services/modules";
import { rateLimit } from "@/src/lib/rate-limit";

export const dynamic = "force-dynamic";

const err = (status: number, code: string, message: string) => Response.json({ error: code, message }, { status });

/** PosBridge (SPEC 20.10): Gäste im Haus für «aufs Zimmer». Header `Authorization: Bearer pnt_…` (Zweck Kasse). */
export async function GET(req: Request) {
  const key = bearer(req.headers.get("authorization"));
  if (!key) return err(401, "unauthorized", "API-Schlüssel fehlt.");
  const k = await authenticate(key);
  if (!k) return err(401, "unauthorized", "API-Schlüssel ungültig oder widerrufen.");
  if (k.scope !== "pos") return err(403, "wrong_scope", "Dieser Schlüssel ist für die Website-Schnittstelle, nicht für die Kasse.");
  if (!rateLimit(`posbridge:${k.id}`, 120, 60_000)) return err(429, "rate_limited", "Zu viele Anfragen (höchstens 120 pro Minute).");
  if (!(await moduleOn(k.hotelId, "posbridge"))) return err(403, "module_off", "Die Kassen-Schnittstelle ist für diesen Betrieb nicht aktiv.");
  return Response.json({ guests: await inHouseForBridge(k.hotelId) }, { headers: { "cache-control": "no-store" } });
}
