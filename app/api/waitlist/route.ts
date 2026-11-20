import { z } from "zod";
import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { errorResponse, json } from "@/src/lib/http";
import { resolvePublicHotel } from "@/src/services/hotels";
import { DirectError, joinWaitlist } from "@/src/services/direct-tools";
import { checkPow } from "@/src/lib/pow";
import { limitByIpAndEmail } from "@/src/lib/public-form";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

const body = z.object({
  hotel: z.string().max(100).optional(),
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(100).optional(),
  language: z.enum(["de", "en", "fr", "it", "nl"]).default("de"),
  checkin: z.string(),
  checkout: z.string(),
  adults: z.number().int().min(1).max(10),
  children: z.number().int().min(0).max(10).default(0),
  children_ages: z.array(z.number().int().min(0).max(17)).max(10).default([]),
  pow: z.string().optional(),
});

/** Warteliste (SPEC 19.29): Gast trägt sich ein, wenn für seine Daten nichts frei ist */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateLimit(`waitlist:${ip}`, 10)) return json({ error: "rate_limited" }, 429);
  try {
    const raw = await req.json();
    if (!(await checkPow(typeof raw?.pow === "string" ? raw.pow : null))) return json({ error: "pow_failed" }, 400);
    const b = body.parse(raw);
    if (!(await limitByIpAndEmail("waitlist", ip, b.email, { ipLimit: 20, ipWindowMs: 3_600_000, emailLimit: env().NODE_ENV === "production" ? 10 : 10_000, emailWindowMs: 3_600_000 }))) return json({ error: "rate_limited" }, 429);
    const hotel = await resolvePublicHotel(req.headers.get("host"), b.hotel);
    if (!hotel) return json({ error: "hotel_not_found" }, 404);
    await joinWaitlist(hotel, { email: b.email, name: b.name, language: b.language, checkin: b.checkin, checkout: b.checkout, adults: b.adults, children: b.children, childAges: b.children_ages });
    return json({ ok: true }, 201);
  } catch (e) {
    if (e instanceof DirectError) return json({ error: e.message }, 400);
    return errorResponse(e);
  }
}
