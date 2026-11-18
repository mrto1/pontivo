import { assetLinks } from "@/src/domain/app-links";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

/** Android App Links (SPEC 19.23) */
export function GET() {
  return Response.json(assetLinks(env().ANDROID_APP_PACKAGE, env().ANDROID_CERT_SHA256), { headers: { "cache-control": "public, max-age=300" } });
}
