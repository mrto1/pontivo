import { env } from "@/src/env";
import { handlePostmarkEvent, postmarkAuthorized } from "@/src/email/suppressions";

export const dynamic = "force-dynamic";

/**
 * Postmark Bounce- und Spam-Beschwerde-Webhook. Postmark signiert nicht; geschützt wird über Basic Auth
 * bzw. Header x-webhook-token mit POSTMARK_WEBHOOK_SECRET. Gesperrte Adressen bekommen keine E-Mails mehr.
 */
export async function POST(req: Request) {
  const secret = env().POSTMARK_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "postmark_webhook_not_configured" }, { status: 503 });
  if (!postmarkAuthorized(req.headers, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    const result = await handlePostmarkEvent(body);
    return Response.json({ received: true, result });
  } catch (e) {
    console.error("[postmark webhook]", e);
    return Response.json({ error: "processing_failed" }, { status: 500 });
  }
}
