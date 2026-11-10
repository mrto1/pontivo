import { cookies } from "next/headers";
import { atLeast, readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";
import { getHotelById } from "@/src/services/hotels";
import { isMonth } from "@/src/services/report";
import { audit } from "@/src/services/audit";
import { db } from "@/src/db/client";
import { taxListCsv, touristTaxList } from "@/src/services/guests";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !atLeast(await roleIn(userId, hotelId), "manager")) return new Response("Not found", { status: 404 });
  const u = new URL(req.url);
  const month = u.searchParams.get("month");
  if (!isMonth(month)) return new Response("Monat fehlt (YYYY-MM)", { status: 400 });
  if (u.searchParams.get("format") === "pdf") return Response.redirect(new URL(`/admin/${hotelId}/guests/tax/print?month=${month}`, u), 303);
  const hotel = await getHotelById(hotelId);
  if (!hotel) return new Response("Not found", { status: 404 });
  const r = await touristTaxList(hotel, month);
  await audit(db(), { hotelId, actor: `user:${userId}`, action: "guest.tax_list_export", details: { month, format: "csv" } });
  return new Response(taxListCsv(r), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="kurtaxe-${hotel.slug}-${month}.csv"` },
  });
}
