import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { issueChallenge, issuePass } from "@/src/lib/pow";

export const dynamic = "force-dynamic";

/** GET: neue Rechenaufgabe. POST { proof }: tauscht eine gelöste Aufgabe gegen einen 30-Minuten-Pass (Chat). */
export async function GET(req: Request) {
  if (!rateLimit(`pow:${clientIp(req)}`, 30)) return Response.json({ error: "rate_limited" }, { status: 429 });
  return Response.json(issueChallenge(), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (!rateLimit(`pow-pass:${clientIp(req)}`, 30)) return Response.json({ error: "rate_limited" }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  const pass = await issuePass(typeof b.proof === "string" ? b.proof : null);
  return pass ? Response.json({ pass }) : Response.json({ error: "invalid" }, { status: 400 });
}
