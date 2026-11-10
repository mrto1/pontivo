import { ZodError } from "zod";
import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { resolvePublicHotel } from "@/src/services/hotels";
import { createInquiry } from "@/src/services/inquiries";
import { safeBack } from "@/src/lib/back";

export const dynamic = "force-dynamic";

/** Anfrageformular der Hotel-Website (normales HTML-Formular, funktioniert ohne JavaScript) */
export async function POST(req: Request) {
  const form = await req.formData();
  const s = (k: string) => String(form.get(k) ?? "").trim();
  const back = safeBack(s("back"));
  const go = (hash: string) => Response.redirect(new URL(`${back}#${hash}`, req.url), 303);
  // Spam: verstecktes Feld muss leer bleiben, höchstens 5 Anfragen pro Minute und IP
  if (s("website")) return go("anfrage-gesendet");
  if (!rateLimit(`inquiry:${clientIp(req)}`, 5)) return go("anfrage-fehler");
  const hotel = await resolvePublicHotel(req.headers.get("host"), s("hotel"));
  if (!hotel) return new Response("Not found", { status: 404 });
  try {
    await createInquiry(hotel, {
      kind: s("kind") as never, name: s("name"), email: s("email"), phone: s("phone") || null,
      dateFrom: s("dateFrom") || null, dateTo: s("dateTo") || null, persons: s("persons") ? Number(s("persons")) : null, timeOfDay: s("time") || null,
      message: s("message"), language: s("lang") || "de", pageSlug: s("page"),
    });
    return go("anfrage-gesendet");
  } catch (e) {
    if (e instanceof ZodError) return go("anfrage-fehler");
    throw e;
  }
}
