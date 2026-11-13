import { sql } from "drizzle-orm";
import { db } from "@/src/db/client";
import { checkSystem } from "@/src/services/monitor";

export const dynamic = "force-dynamic";

/**
 * Für Docker-Healthcheck und Überwachung.
 * Einfach: App läuft und erreicht die Datenbank (Docker startet den Container bei Fehler neu).
 * `?deep=1`: zusätzlich Worker-Lebenszeichen, Rückstau bei E-Mail und Channex, hängende Reservierungen, Speicherplatz.
 * Für einen externen Uptime-Dienst (503 bei Problemen, nur Namen der Probleme, keine Details).
 */
export async function GET(req: Request) {
  try {
    await db().execute(sql`SELECT 1`);
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
  if (new URL(req.url).searchParams.get("deep") !== "1") return Response.json({ ok: true });
  const problems = await checkSystem({ includeWorker: true });
  return Response.json({ ok: problems.length === 0, problems: problems.map((p) => p.name) }, { status: problems.length ? 503 : 200 });
}
