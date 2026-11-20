import { cookies } from "next/headers";
import { exportLimited } from "@/src/lib/export-limit";
import { atLeast, readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";
import { isMonth, monthlyReport, reportCsv } from "@/src/services/report";
import { getHotelById } from "@/src/services/hotels";
import { audit } from "@/src/services/audit";
import { db } from "@/src/db/client";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !atLeast(await roleIn(userId, hotelId), "manager")) return new Response("Not found", { status: 404 });
  const limited = await exportLimited(userId, hotelId);
  if (limited) return limited;
  const month = new URL(req.url).searchParams.get("month");
  if (!isMonth(month)) return new Response("Monat fehlt (YYYY-MM)", { status: 400 });
  const hotel = await getHotelById(hotelId);
  if (!hotel) return new Response("Not found", { status: 404 });
  const r = await monthlyReport(hotelId, month);
  await audit(db(), { hotelId, actor: `user:${userId}`, action: "report.export_csv", details: { month } });
  return new Response(reportCsv(r), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="abrechnung-${hotel.slug}-${month}.csv"`,
    },
  });
}
