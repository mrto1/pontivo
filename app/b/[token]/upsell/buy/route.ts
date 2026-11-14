import { startUpsell, UpsellError } from "@/src/services/upsell";
import { clientIp, rateLimit } from "@/src/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Extras bestellen: Preise werden ausschliesslich auf dem Server aus den Angeboten des Hauses berechnet */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!rateLimit(`upsell:${clientIp(req)}`, 10)) return new Response("Too many requests", { status: 429 });
  const f = await req.formData();
  const selection = [...f.entries()]
    .filter(([k]) => k.startsWith("q_"))
    .map(([k, v]) => ({ id: k.slice(2), quantity: Number(v) }));
  const lang = String(f.get("lang") ?? "");
  const back = (q: string) => Response.redirect(new URL(`/b/${token}/upsell${q}`, req.url), 303);
  try {
    const { url } = await startUpsell(token, selection, "email");
    return Response.redirect(url, 303);
  } catch (e) {
    if (e instanceof UpsellError) return back(e.code === "empty" ? `?empty=1&lang=${encodeURIComponent(lang)}` : `?lang=${encodeURIComponent(lang)}`);
    throw e;
  }
}
