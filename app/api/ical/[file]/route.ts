import { exportFeed } from "@/src/services/ical";

export const dynamic = "force-dynamic";

/** Export-Feed eines Zimmertyps: /api/ical/<token>.ics (SPEC 7b). Der Token ist das Geheimnis; unbekannt → 404. */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const token = file.replace(/\.ics$/, "");
  const body = await exportFeed(token);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=300", "x-robots-tag": "noindex" } });
}
