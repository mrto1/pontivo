import { cookies } from "next/headers";
import { readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";
import { canAccess } from "@/src/domain/roles";
import { moduleOn } from "@/src/services/modules";
import { posItemsTemplate, posTablesTemplate } from "@/src/domain/pos-import";

export const dynamic = "force-dynamic";

/** Vorlagen für den CSV-Import der Restaurantkasse (`?kind=items|tables`) */
export async function GET(req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !canAccess(await roleIn(userId, hotelId), "manager")) return new Response("Not found", { status: 404 });
  if (!(await moduleOn(hotelId, "restaurant"))) return new Response("Not found", { status: 404 });
  const tables = new URL(req.url).searchParams.get("kind") === "tables";
  return new Response(tables ? posTablesTemplate() : posItemsTemplate(), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="pontivo-vorlage-${tables ? "tische" : "artikel"}.csv"`, "cache-control": "no-store" },
  });
}
