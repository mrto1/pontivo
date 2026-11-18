import { z } from "zod";
import { createBookingSchema } from "@/src/lib/validation";
import { apiError, apiJson, readBody, websiteAuth } from "@/src/lib/api-auth";
import { errorResponse } from "@/src/lib/http";
import { createDirectBooking } from "@/src/services/bookings";
import { withIdempotency } from "@/src/services/idempotency";
import { limitByIpAndEmail } from "@/src/lib/public-form";
import { originOf } from "@/src/domain/webhooks";
import { audit } from "@/src/services/audit";
import { db } from "@/src/db/client";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

const body = createBookingSchema.safeExtend({ return_url: z.string().max(500).optional() });

/**
 * Buchung anlegen (SPEC 19.22): reserviert die Zimmer (Hold, 32 Minuten) und liefert den Link zur sicheren Zahlungsseite.
 * Header `Idempotency-Key` schützt gegen doppelte Aufrufe. `return_url`: Rückkehr nach der Zahlung, nur Ursprünge, die das Hotel erlaubt hat.
 * Gleiche Gebühr wie bei der Buchung auf Pontivo. 409 = ausgebucht.
 */
export async function POST(req: Request) {
  const a = await websiteAuth(req, 30);
  if (a instanceof Response) return a;
  const text = await readBody(req);
  if (text === null) return apiError(413, "payload_too_large", "Anfrage zu gross (höchstens 64 KB).");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return apiError(400, "invalid_json", "Kein gültiges JSON."); }
  try {
    const b = body.parse(raw);
    let returnUrl: string | undefined;
    if (b.return_url) {
      const origin = originOf(b.return_url);
      if (!origin || !(a.hotel.content.api?.returnOrigins ?? []).includes(origin)) return apiError(400, "invalid_return_url", "return_url: Ursprung nicht erlaubt (Admin → Website-Schnittstelle).");
      returnUrl = b.return_url;
    }
    const r = await withIdempotency(a.key, req.headers.get("idempotency-key"), text, async () => {
      // Missbrauchsschutz je Schlüssel und Gast-E-Mail (die IP ist die der Website, nicht des Gastes)
      if (!(await limitByIpAndEmail("api-booking", `key:${a.key.id}`, b.guest.email, { ipLimit: 600, ipWindowMs: 3_600_000, emailLimit: env().NODE_ENV === "production" ? 10 : 10_000, emailWindowMs: 3_600_000 }))) return { status: 429, body: { error: "rate_limited", message: "Zu viele Buchungen für diese E-Mail-Adresse." } };
      const { booking, checkoutUrl } = await createDirectBooking(a.hotel, {
        roomTypeId: b.room_type_id, ratePlanId: b.rate_plan_id, checkin: b.checkin, checkout: b.checkout, adults: b.adults, children: b.children, childrenAges: b.children_ages,
        roomCount: b.rooms, voucherCode: b.voucher_code ?? null, extras: b.extras,
        guest: { firstName: b.guest.first_name, lastName: b.guest.last_name, email: b.guest.email, phone: b.guest.phone, language: b.guest.language, notes: b.guest.notes, marketingConsent: b.guest.marketing_consent },
      }, { returnUrl });
      await audit(db(), { hotelId: a.hotel.id, actor: `api:${a.key.id}`, action: "api.booking.create", entity: "booking", entityId: booking.id, details: { reference: booking.reference } });
      return { status: 201, body: { reference: booking.reference, status: booking.status, checkout_url: checkoutUrl, hold_expires_at: booking.holdExpiresAt, total_rappen: booking.totalRappen } };
    });
    return apiJson(r.body, r.status, r.replayed ? { "idempotent-replayed": "true" } : {});
  } catch (e) {
    const res = errorResponse(e);
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }
}
