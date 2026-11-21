import { cookies } from "next/headers";
import { readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";
import { canAccess } from "@/src/domain/roles";
import { getHotelById } from "@/src/services/hotels";
import { exportFiles } from "@/src/services/migration";
import { zipStore } from "@/src/domain/zip";
import { audit } from "@/src/services/audit";
import { db } from "@/src/db/client";

export const dynamic = "force-dynamic";

/** Gesamtexport «Meine Daten» (nur Inhaber): ZIP mit einer CSV je Tabelle, nur des eigenen Betriebs */
export async function GET(_req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !canAccess(await roleIn(userId, hotelId), "owner", "migration")) return new Response("Not found", { status: 404 });
  const hotel = await getHotelById(hotelId);
  if (!hotel) return new Response("Not found", { status: 404 });
  const files = await exportFiles(hotel);
  await audit(db(), { hotelId, actor: `user:${userId}`, action: "export.all", details: { files: files.length } });
  const zip = zipStore(files.map((f) => ({ name: f.name, data: Buffer.from(f.csv, "utf8") })));
  return new Response(new Uint8Array(zip), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="pontivo-export-${hotel.slug}-${new Date().toISOString().slice(0, 10)}.zip"`, "cache-control": "no-store" } });
}
