import { apiHotel } from "@/src/auth/api";
import { syncRequest } from "@/src/domain/pos-offline";
import { DeviceError, syncOps } from "@/src/services/pos-sync";

export const dynamic = "force-dynamic";

/** Offline-Kasse: lokal gesammelte Vorgänge übernehmen. Antwort je Vorgang; Wiederholungen sind unschädlich (Ids vom Gerät). */
export async function POST(req: Request) {
  const body = syncRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
  const a = await apiHotel(req, body.data.hotelId, "kasse", "pos");
  if (a.error) return a.error;
  try {
    const results = await syncOps(a.hotel, body.data.deviceKey, body.data.deviceCode, body.data.pending, body.data.ops, a.actor);
    return Response.json({ results }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof DeviceError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
