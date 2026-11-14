import { cookies } from "next/headers";
import { readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";
import { canAccess } from "@/src/domain/roles";
import { getHotelById } from "@/src/services/hotels";
import { moduleOn } from "@/src/services/modules";
import { GroupError, groupDetail, roomingCsv } from "@/src/services/groups";

export const dynamic = "force-dynamic";

/** Rooming-Liste der Gruppe als CSV */
export async function GET(_req: Request, ctx: { params: Promise<{ hotelId: string; groupId: string }> }) {
  const { hotelId, groupId } = await ctx.params;
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !canAccess(await roleIn(userId, hotelId), "staff", "groups")) return new Response("Not found", { status: 404 });
  const hotel = await getHotelById(hotelId);
  if (!hotel || !(await moduleOn(hotelId, "groups"))) return new Response("Not found", { status: 404 });
  try {
    const d = await groupDetail(hotelId, groupId);
    return new Response(roomingCsv(d.rooming), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="rooming-${d.group.arrival}.csv"`, "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof GroupError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
