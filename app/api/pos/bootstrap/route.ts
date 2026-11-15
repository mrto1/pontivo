import { apiHotel } from "@/src/auth/api";
import { bootstrapRequest } from "@/src/domain/pos-offline";
import { DeviceError, bootstrap } from "@/src/services/pos-sync";

export const dynamic = "force-dynamic";

/** Offline-Kasse: Artikel, Tische, Gäste im Haus und offene Bestellungen zum Mitnehmen; belegt das Gerät für diesen Browser */
export async function POST(req: Request) {
  const body = bootstrapRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
  const a = await apiHotel(req, body.data.hotelId, "kasse", "pos");
  if (a.error) return a.error;
  try {
    return Response.json(await bootstrap(a.hotel, body.data.deviceKey, body.data.deviceCode), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof DeviceError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
