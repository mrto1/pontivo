import { and, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { extras, ratePlans, roomTypes } from "@/src/db/schema";
import { hotelLocales } from "@/src/i18n/dict";
import { apiJson, websiteAuth } from "@/src/lib/api-auth";

export const dynamic = "force-dynamic";

/** Stammdaten für die eigene Website: Betrieb, Zimmertypen, Tarife (SPEC 19.22) */
export async function GET(req: Request) {
  const a = await websiteAuth(req);
  if (a instanceof Response) return a;
  const { hotel } = a;
  const types = await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true)));
  const plans = await db().select().from(ratePlans).where(and(eq(ratePlans.hotelId, hotel.id), eq(ratePlans.active, true)));
  const ex = await db().select().from(extras).where(and(eq(extras.hotelId, hotel.id), eq(extras.active, true)));
  return apiJson({
    name: hotel.name, currency: "CHF", timezone: hotel.timezone, languages: hotelLocales(hotel), default_language: hotel.defaultLanguage,
    checkin_time: hotel.checkinTime.slice(0, 5), checkout_time: hotel.checkoutTime.slice(0, 5), bookable: hotel.status === "live",
    room_types: types.map((r) => ({ id: r.id, name: r.name, description: r.description, max_occupancy: r.maxOccupancy, photos: r.photos })),
    extras: ex.map((e) => ({ id: e.id, name: e.name, description: e.description, price_rappen: e.priceRappen, unit: e.unit, max_quantity: e.maxQuantity, mandatory: e.mandatory, room_type_ids: e.roomTypeIds })),
    rate_plans: plans.map((p) => ({ id: p.id, room_type_id: p.roomTypeId, name: p.name, board: p.board })),
  });
}
