import { errorResponse, json } from "@/src/lib/http";
import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { env } from "@/src/env";
import { getBookingByToken } from "@/src/services/bookings";
import { resumeIntent } from "@/src/services/element-payments";

export const dynamic = "force-dynamic";

/**
 * SPEC 19.52: «Zahlung fortsetzen» für das Payment Element (Seite neu geladen, TWINT abgebrochen, Karte abgelehnt).
 * Gibt das client_secret des offenen PaymentIntent nur für eine noch reservierte Buchung heraus (der Buchungslink ist das Geheimnis).
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!rateLimit(`pay:${clientIp(req)}`, 30)) return json({ error: "rate_limited" }, 429);
  try {
    const { token } = await ctx.params;
    const found = await getBookingByToken(token);
    if (!found) return json({ error: "not_found" }, 404);
    if (found.booking.status === "confirmed") return json({ state: "paid", confirmed: true });
    if (found.booking.status !== "hold") return json({ state: "gone" });
    const r = await resumeIntent(found.hotel, found.booking.id);
    if (r.state !== "open") return json({ state: r.state });
    return json({ state: "open", client_secret: r.clientSecret, stripe_account: r.stripeAccount, publishable_key: env().STRIPE_PUBLISHABLE_KEY ?? null, amount_rappen: r.amountRappen });
  } catch (e) {
    // Stripe nicht erreichbar o. Ä.: der Client zeigt «später erneut versuchen», die Reservierung bleibt
    return errorResponse(e);
  }
}
