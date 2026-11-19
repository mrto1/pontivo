import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import { bookings } from "@/src/db/schema";
import { apiError, apiJson, readBody, websiteAuth } from "@/src/lib/api-auth";
import { BookingError } from "@/src/services/bookings";
import { changeBookingByApi, PriceDiffers } from "@/src/services/booking-changes";
import { withIdempotency } from "@/src/services/idempotency";

export const dynamic = "force-dynamic";

const view = (b: typeof bookings.$inferSelect) => ({ reference: b.reference, status: b.status, checkin: b.checkin, checkout: b.checkout, adults: b.adults, children: b.children, total_rappen: b.totalRappen, source: b.source, hold_expires_at: b.holdExpiresAt, confirmed_at: b.confirmedAt });

async function find(hotelId: string, reference: string) {
  const [b] = await db().select().from(bookings).where(and(eq(bookings.hotelId, hotelId), eq(bookings.reference, reference.trim().toUpperCase())));
  return b;
}

/** Status einer Buchung des eigenen Betriebs (SPEC 19.22): so sieht die Website, ob bezahlt und bestätigt ist. */
export async function GET(req: Request, { params }: { params: Promise<{ reference: string }> }) {
  const a = await websiteAuth(req);
  if (a instanceof Response) return a;
  const b = await find(a.hotel.id, (await params).reference);
  if (!b) return apiError(404, "not_found", "Buchung nicht gefunden.");
  return apiJson(view(b));
}

const patch = z.object({
  checkin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  guest: z.object({ first_name: z.string().trim().min(1).max(100).optional(), last_name: z.string().trim().min(1).max(100).optional(), phone: z.string().trim().max(40).nullable().optional() }).strict().optional(),
  dry_run: z.boolean().optional(),
}).strict();

/**
 * Nachträglich ändern (SPEC 19.24): neues `checkin` (gleiche Nächte, gleiche Zimmer, Preis muss gleich bleiben) und/oder Name/Telefon des Gasts.
 * `dry_run: true` prüft nur (Verfügbarkeit, Preis) und ändert nichts. Mit `Idempotency-Key` wiederholbar.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ reference: string }> }) {
  const a = await websiteAuth(req, 30);
  if (a instanceof Response) return a;
  const b = await find(a.hotel.id, (await params).reference);
  if (!b) return apiError(404, "not_found", "Buchung nicht gefunden.");
  const text = await readBody(req);
  if (text === null) return apiError(413, "payload_too_large", "Anfrage zu gross (höchstens 64 KB).");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return apiError(400, "invalid_json", "Kein gültiges JSON."); }
  const p = patch.safeParse(raw);
  if (!p.success || (!p.data.checkin && !p.data.guest)) return apiError(400, "invalid", "Erlaubt: checkin (YYYY-MM-DD), guest {first_name, last_name, phone}, dry_run.");
  const d = p.data;
  const run = async () => {
    try {
      const r = await changeBookingByApi(a.hotel, b.id, { checkin: d.checkin, guest: d.guest && { firstName: d.guest.first_name, lastName: d.guest.last_name, phone: d.guest.phone } }, { actor: `api:${a.key.id}`, dryRun: d.dry_run });
      return { status: 200, body: { ...view(r.booking), changed: r.changed, dry_run: r.dryRun } };
    } catch (e) {
      if (e instanceof PriceDiffers) return { status: 409, body: { error: "price_differs", message: "Für die neuen Daten gilt ein anderer Preis; über die API nur bei gleichem Preis möglich.", current_rooms_rappen: e.currentRoomsRappen, new_rooms_rappen: e.newRoomsRappen } };
      if (e instanceof BookingError) return { status: e.httpStatus, body: { error: e.code, message: `Änderung nicht möglich: ${e.code}` } };
      throw e;
    }
  };
  // Probelauf nie speichern; sonst gegen doppelte Aufrufe absichern
  if (d.dry_run) { const r = await run(); return apiJson(r.body, r.status); }
  const r = await withIdempotency(a.key, req.headers.get("idempotency-key"), text + "|" + b.reference, run);
  return apiJson(r.body, r.status, r.replayed ? { "idempotent-replayed": "true" } : {});
}
