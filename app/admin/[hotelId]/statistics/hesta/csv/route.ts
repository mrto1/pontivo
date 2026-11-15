import { cookies } from "next/headers";
import { readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";
import { canAccess } from "@/src/domain/roles";
import { getHotelById } from "@/src/services/hotels";
import { moduleOn } from "@/src/services/modules";
import { hestaMonth } from "@/src/services/hesta";
import { hestaCsv } from "@/src/domain/hesta";
import { countryName } from "@/src/domain/countries";
import { audit } from "@/src/services/audit";
import { db } from "@/src/db/client";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !canAccess(await roleIn(userId, hotelId), "staff", "statistics")) return new Response("Not found", { status: 404 });
  const hotel = await getHotelById(hotelId);
  if (!hotel || !(await moduleOn(hotelId, "statistics"))) return new Response("Not found", { status: 404 });
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response("Monat fehlt (JJJJ-MM)", { status: 400 });
  const r = await hestaMonth(hotelId, month);
  await audit(db(), { hotelId, actor: `user:${userId}`, action: "hesta.export", details: { month, rows: r.rows.length } });
  return new Response(hestaCsv(month, r.rows, (c) => (c ? countryName(c) : "Land unbekannt")), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="hesta-${hotel.slug}-${month}.csv"`, "cache-control": "no-store" } });
}
