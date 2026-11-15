import { verifyChannexSignature } from "@/src/integrations/channex/signature";
import { ingestWebhook } from "@/src/services/inbox";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

/** SPEC 19.9: Channex-Webhook für Nachrichten. Signatur über den rohen Body prüfen, dann speichern (idempotent). */
export async function POST(req: Request) {
  const secret = env().CHANNEX_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "channex_not_configured" }, { status: 503 });
  const raw = await req.text();
  if (!verifyChannexSignature(raw, req.headers.get("x-hmac-signature-256"), req.headers.get("x-hmac-timestamp"), secret)) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    await ingestWebhook(body);
  } catch (e) {
    console.error("[channex messages webhook]", e);
    return Response.json({ error: "failed" }, { status: 500 }); // Channex wiederholt
  }
  return Response.json({ received: true }, { status: 202 });
}
