import { feedAuthorized } from "@/src/lib/google-feed-auth";
import { hotelListXml } from "@/src/services/google-hotels";

export const dynamic = "force-dynamic";

/** Hotelliste (XML) für Google Hotel Center (SPEC 19.70), Abruf mit geheimem Wert `?token=` */
export async function GET(req: Request) {
  if (!feedAuthorized(req)) return new Response("Nicht gefunden", { status: 404 });
  const { xml } = await hotelListXml();
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" } });
}
