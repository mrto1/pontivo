import { sql } from "drizzle-orm";
import { db } from "@/src/db/client";

export const dynamic = "force-dynamic";

/** Für Docker-Healthcheck und Überwachung: App läuft und erreicht die Datenbank */
export async function GET() {
  try {
    await db().execute(sql`SELECT 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
