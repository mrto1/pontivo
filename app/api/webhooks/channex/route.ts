import { verifyChannexSignature } from "@/src/integrations/channex/signature";
import { triggerChannexFeed } from "@/src/jobs/queue";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

/**
 * SPEC 7.3: Signatur prüfen (roher Body), dann nur den Job channex-feed anstossen.
 * Die Buchungen selbst kommen immer über den Feed (mit Ack).
 */
export async function POST(req: Request) {
  const secret = env().CHANNEX_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "channex_not_configured" }, { status: 503 });
  const raw = await req.text();
  const ok = verifyChannexSignature(raw, req.headers.get("x-hmac-signature-256"), req.headers.get("x-hmac-timestamp"), secret);
  if (!ok) return Response.json({ error: "invalid_signature" }, { status: 401 });
  try {
    await triggerChannexFeed();
  } catch (e) {
    // Kein Problem: channex-feed läuft ohnehin alle 15 Minuten
    console.error("[channex webhook] Job konnte nicht angestossen werden", e);
  }
  return Response.json({ received: true }, { status: 202 });
}
