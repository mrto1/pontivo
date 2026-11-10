import { cookies } from "next/headers";
import { atLeast, readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";
import { getHotelById } from "@/src/services/hotels";
import { isDay } from "@/src/domain/dates";
import { logRegisterExport, registerCsv, registerRows } from "@/src/services/guests";

export const dynamic = "force-dynamic";

/** Gästeregister als CSV (SPEC 14.5); format=pdf → Druckansicht. Jeder Export steht im audit_log. */
export async function GET(req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !atLeast(await roleIn(userId, hotelId), "staff")) return new Response("Not found", { status: 404 });
  const u = new URL(req.url);
  const from = u.searchParams.get("from") ?? "";
  const to = u.searchParams.get("to") ?? "";
  if (!isDay(from) || !isDay(to) || from > to) return new Response("Zeitraum fehlt (from, to als YYYY-MM-DD)", { status: 400 });
  if (u.searchParams.get("format") === "pdf") return Response.redirect(new URL(`/admin/${hotelId}/guests/register/print?from=${from}&to=${to}`, u), 303);
  const hotel = await getHotelById(hotelId);
  if (!hotel) return new Response("Not found", { status: 404 });
  const list = await registerRows(hotelId, from, to);
  await logRegisterExport(hotelId, from, to, "csv", list.length, `user:${userId}`);
  return new Response(registerCsv(list), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="gaesteregister-${hotel.slug}-${from}-${to}.csv"`, "cache-control": "no-store" },
  });
}
