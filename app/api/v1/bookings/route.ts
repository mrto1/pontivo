import { z } from "zod";
import { createBookingSchema } from "@/src/lib/validation";
import { apiError, websiteAuth } from "@/src/lib/api-auth";
import { errorResponse } from "@/src/lib/http";
import { createDirectBooking } from "@/src/services/bookings";
import { limitByIpAndEmail } from "@/src/lib/public-form";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

// Für die API ohne Hotel-Slug (der Betrieb kommt aus dem Schlüssel)
const body = createBookingSchema;

/**
 * Buchung anlegen (SPEC 19.22): reserviert die Zimmer (Hold, 32 Minuten) und liefert den Link zur sicheren Zahlungsseite.
 * Die Website leitet den Gast auf `checkout_url` weiter; bestätigt wird die Buchung erst nach der Zahlung (Webhook), danach Mail an den Gast.
 * Gleiche Gebühr wie bei der Buchung auf Pontivo. 409 = ausgebucht.
 */
export async function POST(req: Request) {
  const a = await websiteAuth(req, 30);
  if (a instanceof Response) return a;
  let raw: unknown;
  try { raw = await req.json(); } catch { return apiError(400, "invalid_json", "Kein gültiges JSON."); }
  try {
    const b = body.parse(raw);
    // Missbrauchsschutz je Schlüssel und Gast-E-Mail (die IP ist die der Website, nicht des Gastes)
    if (!(await limitByIpAndEmail("api-booking", `key:${a.key.id}`, b.guest.email, { ipLimit: 600, ipWindowMs: 3_600_000, emailLimit: env().NODE_ENV === "production" ? 10 : 10_000, emailWindowMs: 3_600_000 }))) return apiError(429, "rate_limited", "Zu viele Buchungen für diese E-Mail-Adresse.");
    const { booking, checkoutUrl } = await createDirectBooking(a.hotel, {
      roomTypeId: b.room_type_id, ratePlanId: b.rate_plan_id, checkin: b.checkin, checkout: b.checkout, adults: b.adults, children: b.children, childrenAges: b.children_ages,
      roomCount: b.rooms, voucherCode: b.voucher_code ?? null, extras: b.extras,
      guest: { firstName: b.guest.first_name, lastName: b.guest.last_name, email: b.guest.email, phone: b.guest.phone, language: b.guest.language, notes: b.guest.notes, marketingConsent: b.guest.marketing_consent },
    }, {});
    return Response.json({ reference: booking.reference, status: booking.status, checkout_url: checkoutUrl, hold_expires_at: booking.holdExpiresAt, total_rappen: booking.totalRappen }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(e);
    return errorResponse(e);
  }
}
