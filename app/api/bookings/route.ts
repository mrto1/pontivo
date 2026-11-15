import { createBookingSchema } from "@/src/lib/validation";
import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { errorResponse, json } from "@/src/lib/http";
import { resolvePublicHotel } from "@/src/services/hotels";
import { createDirectBooking } from "@/src/services/bookings";
import { env } from "@/src/env";
import { checkPow } from "@/src/lib/pow";
import { limitByIpAndEmail } from "@/src/lib/public-form";

export const dynamic = "force-dynamic";

/** SPEC 8: Hold + Checkout-Session → { checkout_url }; 409 wenn ausgebucht */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateLimit(`booking:${ip}`)) return json({ error: "rate_limited" }, 429);
  try {
    const raw = await req.json();
    // Rechenaufgabe (SPEC 18.11) und Grenzen je IP und E-Mail in der Datenbank
    if (!(await checkPow(typeof raw?.pow === "string" ? raw.pow : null))) return json({ error: "pow_failed" }, 400);
    const body = createBookingSchema.parse(raw);
    if (!(await limitByIpAndEmail("booking", ip, body.guest.email, { ipLimit: 30, ipWindowMs: 3_600_000, emailLimit: env().NODE_ENV === "production" ? 10 : 10_000, emailWindowMs: 3_600_000 }))) return json({ error: "rate_limited" }, 429);
    const hotel = await resolvePublicHotel(req.headers.get("host"), body.hotel);
    if (!hotel) return json({ error: "hotel_not_found" }, 404);
    const { booking, checkoutUrl } = await createDirectBooking(
      hotel,
      {
        roomTypeId: body.room_type_id,
        ratePlanId: body.rate_plan_id,
        checkin: body.checkin,
        checkout: body.checkout,
        adults: body.adults,
        children: body.children,
        childrenAges: body.children_ages,
        roomCount: body.rooms,
        voucherCode: body.voucher_code ?? null,
        extras: body.extras,
        guest: {
          firstName: body.guest.first_name,
          lastName: body.guest.last_name,
          email: body.guest.email,
          phone: body.guest.phone,
          language: body.guest.language,
          notes: body.guest.notes,
          marketingConsent: body.guest.marketing_consent,
        },
      },
      { ip },
    );
    return json({ checkout_url: checkoutUrl, reference: booking.reference }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
