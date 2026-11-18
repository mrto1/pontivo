import { bearer, folioItemRequest } from "@/src/domain/posbridge";
import { PosBridgeError, addItemFromPos, authenticate } from "@/src/services/posbridge";
import { moduleOn } from "@/src/services/modules";
import { rateLimit } from "@/src/lib/rate-limit";

export const dynamic = "force-dynamic";

const err = (status: number, code: string, message: string) => Response.json({ error: code, message }, { status });

/**
 * PosBridge (SPEC 19.15): Posten aufs Zimmer buchen.
 * Header `Authorization: Bearer pnt_…`. Body: booking_reference ODER room_number, description, quantity, unit_price_rappen, vat, external_id.
 * 201 = neu gebucht, 200 = Wiederholung (gleiche external_id, gleicher Inhalt).
 */
export async function POST(req: Request) {
  const key = bearer(req.headers.get("authorization"));
  if (!key) return err(401, "unauthorized", "API-Schlüssel fehlt.");
  const k = await authenticate(key);
  if (!k) return err(401, "unauthorized", "API-Schlüssel ungültig oder widerrufen.");
  if (k.scope !== "pos") return err(403, "wrong_scope", "Dieser Schlüssel ist für die Website-Schnittstelle, nicht für die Kasse.");
  if (!rateLimit(`posbridge:${k.id}`, 120, 60_000)) return err(429, "rate_limited", "Zu viele Anfragen (höchstens 120 pro Minute).");
  if (!(await moduleOn(k.hotelId, "posbridge"))) return err(403, "module_off", "Die Kassen-Schnittstelle ist für diesen Betrieb nicht aktiv.");
  let body: unknown;
  try { body = await req.json(); } catch { return err(400, "invalid_json", "Kein gültiges JSON."); }
  const parsed = folioItemRequest.safeParse(body);
  if (!parsed.success) return err(400, "invalid", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  try {
    const r = await addItemFromPos(k, parsed.data);
    return Response.json({ id: r.item.id, booking_reference: r.bookingReference, external_id: r.item.externalId, amount_rappen: r.item.quantity * r.item.unitPriceRappen, duplicate: !r.created }, { status: r.created ? 201 : 200 });
  } catch (e) {
    if (e instanceof PosBridgeError) return err(e.code === "not_found" ? 404 : 409, e.code, e.message);
    throw e;
  }
}
