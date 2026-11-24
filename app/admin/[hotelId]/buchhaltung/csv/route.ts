import { cookies } from "next/headers";
import { exportLimited } from "@/src/lib/export-limit";
import { readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";
import { canAccess } from "@/src/domain/roles";
import { journalCsv } from "@/src/domain/accounting-export";
import { abacusAccountProblems, abacusCsv } from "@/src/domain/abacus-export";
import { getHotelById } from "@/src/services/hotels";
import { moduleOn } from "@/src/services/modules";
import { journalFor, periodRange } from "@/src/services/accounting-export";
import { audit } from "@/src/services/audit";
import { db } from "@/src/db/client";

export const dynamic = "force-dynamic";

/** Buchungsjournal als CSV (SPEC 18.3); jeder Export steht im audit_log */
export async function GET(req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !canAccess(await roleIn(userId, hotelId), "staff", "accountingexport")) return new Response("Not found", { status: 404 });
  const limited = await exportLimited(userId, hotelId);
  if (limited) return limited;
  const hotel = await getHotelById(hotelId);
  if (!hotel || !(await moduleOn(hotelId, "accountingexport"))) return new Response("Not found", { status: 404 });
  const p = new URL(req.url).searchParams.get("p") ?? "";
  const r = periodRange(p);
  if (!r) return new Response("Zeitraum fehlt (JJJJ-MM, JJJJ-Qn oder JJJJ)", { status: 400 });
  const rows = await journalFor(hotel, r.from, r.to);
  const format = new URL(req.url).searchParams.get("f") === "abacus" ? "abacus" : "journal";
  if (format === "abacus") {
    const bad = abacusAccountProblems(rows);
    if (bad.length) return new Response(`Abacus nimmt nur Kontonummern aus Ziffern (höchstens 11). Bitte unter Buchhaltung → Konten anpassen: ${bad.join(", ")}`, { status: 400 });
  }
  await audit(db(), { hotelId, actor: `user:${userId}`, action: "accounting.export", details: { period: p, rows: rows.length, format } });
  return new Response(format === "abacus" ? abacusCsv(rows) : journalCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${format === "abacus" ? "abacus" : "buchungen"}-${hotel.slug}-${p}.csv"`, "cache-control": "no-store" } });
}
