import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { isLocale, type Locale } from "@/src/i18n/dict";
import { arrivalForToken } from "@/src/services/arrival";

export const dynamic = "force-dynamic";

/** Ankunftsinfos für den Gast (Karte im Chat). Body: { token, lang }. Nur während des Aufenthalts, sonst 403. */
export async function POST(req: Request) {
  let b: { token?: unknown; lang?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ status: "invalid" }, { status: 400 });
  }
  // Schutz vor Erraten von Links: wenige Versuche pro Minute und IP
  if (!rateLimit(`arrival:${clientIp(req)}`, 20)) return Response.json({ status: "error" }, { status: 429 });
  const token = typeof b.token === "string" ? b.token.slice(0, 100) : "";
  const lang: Locale = typeof b.lang === "string" && isLocale(b.lang) ? b.lang : "de";
  const r = await arrivalForToken(token, lang);
  if (r.status !== "ok") return Response.json({ status: "not_allowed" }, { status: 403 });
  return Response.json(r);
}
