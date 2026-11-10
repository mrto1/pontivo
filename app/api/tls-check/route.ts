import { getHotelByHost } from "@/src/services/hotels";

export const dynamic = "force-dynamic";

/**
 * Caddy fragt vor einem neuen Zertifikat (on_demand_tls): Gehört die Domain zu einem Hotel?
 * Nur dann 200 – so kann niemand beliebige Domains auf den Server zeigen lassen und Zertifikate auslösen.
 */
export async function GET(req: Request) {
  const domain = new URL(req.url).searchParams.get("domain") ?? "";
  if (!/^[a-z0-9.-]{3,253}$/i.test(domain)) return new Response("no", { status: 404 });
  return (await getHotelByHost(domain)) ? new Response("ok") : new Response("no", { status: 404 });
}
