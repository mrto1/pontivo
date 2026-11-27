import { feedAuthorized } from "@/src/lib/google-feed-auth";
import { landingPagesXml } from "@/src/services/google-hotels";

export const dynamic = "force-dynamic";

/** Landingpage-Datei (XML) für Google Hotel Center (SPEC 19.70), Abruf mit geheimem Wert `?token=` */
export async function GET(req: Request) {
  if (!feedAuthorized(req)) return new Response("Nicht gefunden", { status: 404 });
  return new Response(landingPagesXml(), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" } });
}
