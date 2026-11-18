import { appleSiteAssociation } from "@/src/domain/app-links";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

/** iOS Universal Links (SPEC 19.23): ohne Dateiendung, Inhaltstyp JSON */
export function GET() {
  return Response.json(appleSiteAssociation(env().APPLE_TEAM_ID, env().IOS_BUNDLE_ID), { headers: { "cache-control": "public, max-age=300" } });
}
