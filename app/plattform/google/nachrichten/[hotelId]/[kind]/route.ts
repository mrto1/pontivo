import { requirePlatformAdmin } from "@/src/auth/guard";
import { GOOGLE_PATHS } from "@/src/domain/google-hotels";
import { getHotelById } from "@/src/services/hotels";
import { previewMessages } from "@/src/services/google-hotels";

export const dynamic = "force-dynamic";

/** Nachricht eines Betriebs an Google ansehen (nur Plattform-Admin, SPEC 19.70): zum Prüfen gegen die Schemas von Google und für die Zertifizierung */
export async function GET(req: Request, { params }: { params: Promise<{ hotelId: string; kind: string }> }) {
  await requirePlatformAdmin();
  const { hotelId, kind } = await params;
  const hotel = /^[0-9a-f-]{36}$/.test(hotelId) ? await getHotelById(hotelId) : null;
  if (!hotel || !(kind in GOOGLE_PATHS)) return new Response("Nicht gefunden", { status: 404 });
  const msgs = (await previewMessages(hotel)).filter((m) => m.kind === kind);
  if (!msgs.length) return new Response("Keine Nachricht", { status: 404 });
  // Bei vielen Produkten sind es mehrere Nachrichten; `?teil=2` holt die zweite (jede Nachricht ist ein eigenes, gültiges XML)
  const n = Math.min(msgs.length, Math.max(1, Number(new URL(req.url).searchParams.get("teil")) || 1));
  return new Response(msgs[n - 1]!.xml, { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${kind}-${hotel.slug}${msgs.length > 1 ? `-${n}` : ""}.xml"`, "x-teile": String(msgs.length) } });
}
