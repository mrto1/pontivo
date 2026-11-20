import { cookies } from "next/headers";
import { exportLimited } from "@/src/lib/export-limit";
import { readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";
import { canAccess } from "@/src/domain/roles";
import { getHotelById } from "@/src/services/hotels";
import { calendarData } from "@/src/services/inventory";
import { calendarCsv } from "@/src/domain/calendar-export";
import { addDays, isDay } from "@/src/domain/dates";
import { audit } from "@/src/services/audit";
import { db } from "@/src/db/client";

export const dynamic = "force-dynamic";
const MAX_DAYS = 366;

export async function GET(req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !canAccess(await roleIn(userId, hotelId), "staff", "calendar")) return new Response("Not found", { status: 404 });
  const limited = await exportLimited(userId, hotelId);
  if (limited) return limited;
  const hotel = await getHotelById(hotelId);
  if (!hotel) return new Response("Not found", { status: 404 });
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!isDay(from) || !isDay(to) || to < from) return new Response("Zeitraum ungültig (from, to als JJJJ-MM-TT)", { status: 400 });
  if (to > addDays(from, MAX_DAYS - 1)) return new Response(`Zeitraum höchstens ${MAX_DAYS} Tage`, { status: 400 });
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  const cal = await calendarData(hotel.id, from, days);
  await audit(db(), { hotelId, actor: `user:${userId}`, action: "calendar.export", details: { from, to } });
  return new Response(calendarCsv(cal, from, to), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="kalender-${hotel.slug}-${from}_${to}.csv"`, "cache-control": "no-store" } });
}
