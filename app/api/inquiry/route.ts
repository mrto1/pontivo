import { ZodError } from "zod";
import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { resolvePublicHotel } from "@/src/services/hotels";
import { createInquiry } from "@/src/services/inquiries";
import { safeBack } from "@/src/lib/back";
import { checkPow } from "@/src/lib/pow";
import { limitByIpAndEmail } from "@/src/lib/public-form";

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
  // Rechenaufgabe (SPEC 18.11), dann Grenzen je IP und E-Mail in der Datenbank
  if (!(await checkPow(s("_pow")))) return go("anfrage-fehler");
  if (!(await limitByIpAndEmail("inquiry", clientIp(req), s("email"), { ipLimit: 20, ipWindowMs: 3_600_000, emailLimit: 5, emailWindowMs: 3_600_000 }))) return go("anfrage-fehler");
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
