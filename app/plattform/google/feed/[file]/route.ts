import { requirePlatformAdmin } from "@/src/auth/guard";
import { actionsCenterFeeds } from "@/src/services/google";

export const dynamic = "force-dynamic";

/** Feed-Datei für das Actions Center herunterladen (nur Plattform-Admin, SPEC 19.67) */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  await requirePlatformAdmin();
  const { file } = await params;
  const f = await actionsCenterFeeds();
  const pick = { entity: f.entity, "entity-desc": f.entity.descriptor, action: f.action, "action-desc": f.action.descriptor }[file];
  if (!pick) return new Response("Nicht gefunden", { status: 404 });
  return new Response(JSON.stringify(pick.data, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${pick.file}"` } });
}
