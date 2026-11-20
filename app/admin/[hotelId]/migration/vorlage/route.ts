import { cookies } from "next/headers";
import { exportLimited } from "@/src/lib/export-limit";
import { readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";
import { canAccess } from "@/src/domain/roles";
import { importTemplate } from "@/src/domain/import-csv";

export const dynamic = "force-dynamic";

/** Vorlage für die Datenübernahme (CSV mit Kopfzeile und zwei Beispielen) */
export async function GET(_req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !canAccess(await roleIn(userId, hotelId), "manager", "migration")) return new Response("Not found", { status: 404 });
  const limited = await exportLimited(userId, hotelId);
  if (limited) return limited;
  return new Response(importTemplate(), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="pontivo-vorlage-reservierungen.csv"', "cache-control": "no-store" } });
}
