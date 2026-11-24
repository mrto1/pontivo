import { notFound } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { exportLimited } from "@/src/lib/export-limit";
import { onlineSalesDays } from "@/src/services/online-sales";
import { salesCsv } from "@/src/domain/online-sales";
import { monthEnd } from "@/src/domain/platform-invoice";

export const dynamic = "force-dynamic";

/** CSV der Online-Verkäufe eines Monats (SPEC 20.8) */
export async function GET(req: Request, { params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const c = await requireHotelModule("restaurant", hotelId, "staff", "onlinesales");
  const limited = await exportLimited(c.user.id, c.hotel.id);
  if (limited) return limited;
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) notFound();
  const csv = salesCsv(await onlineSalesDays(c.hotel, `${month}-01`, monthEnd(month)));
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="online-verkaeufe-${month}.csv"`, "cache-control": "no-store" } });
}
