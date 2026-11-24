import { notFound } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { exportLimited } from "@/src/lib/export-limit";
import { exportCsv } from "@/src/services/pos";

export const dynamic = "force-dynamic";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request, { params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const c = await requireHotelModule("pos", hotelId, "manager");
  const limited = await exportLimited(c.user.id, c.hotel.id);
  if (limited) return limited;
  const u = new URL(req.url);
  const from = u.searchParams.get("from") ?? "", to = u.searchParams.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to)) notFound();
  const csv = await exportCsv(c.hotel.id, from, to);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="kasse-${from}-${to}.csv"`, "cache-control": "no-store" } });
}
